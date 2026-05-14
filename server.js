import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function makeUserId() {
  return `U${Date.now().toString().slice(-6)}`;
}

function extractUser(content = "") {
  const match = String(content).match(/NAP\s+(U\d+)\s+([a-zA-Z0-9_]+)/i);

  if (!match) return null;

  return {
    userId: match[1].toUpperCase(),
    username: match[2],
  };
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    app: "TapHoaTX API",
    status: "running",
  });
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const { data: users, error } = await supabase
      .from("users")
      .select("*");

    if (error) {
      return res.json({
        ok: false,
        message: error.message,
      });
    }

    const user = users.find(
      (u) =>
        String(u.username).toLowerCase() ===
          String(username).toLowerCase() &&
        String(u.password) === String(password)
    );

    if (!user) {
      return res.json({
        ok: false,
        message: "Sai tài khoản hoặc mật khẩu",
      });
    }

    return res.json({
      ok: true,
      user,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: err.message,
    });
  }
});

app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.json({
        ok: false,
        message: "Thiếu username hoặc mật khẩu",
      });
    }

    const cleanUsername = String(username).trim();

    const { data: users, error: checkError } = await supabase
      .from("users")
      .select("id, username");

    if (checkError) {
      return res.json({
        ok: false,
        message: checkError.message,
      });
    }

    const existed = users.find(
      (u) =>
        String(u.username).toLowerCase() ===
        cleanUsername.toLowerCase()
    );

    if (existed) {
      return res.json({
        ok: false,
        message: "Username đã tồn tại",
      });
    }

    const newUser = {
      id: makeUserId(),
      username: cleanUsername,
      password,
      name: "User mới",
      role: "user",
      balance: 0,
      total_deposit: 0,
      last_deposit: "-",
    };

    const { data: user, error } = await supabase
      .from("users")
      .insert(newUser)
      .select()
      .single();

    if (error) {
      return res.json({
        ok: false,
        message: error.message,
      });
    }

    return res.json({
      ok: true,
      user,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: err.message,
    });
  }
});

app.get("/api/user/:id", async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from("users")
      .select(
        "id, username, name, role, balance, total_deposit, last_deposit, created_at"
      )
      .eq("id", req.params.id.toUpperCase())
      .maybeSingle();

    if (error) {
      return res.json({
        ok: false,
        reason: "supabase_error",
        error: error.message,
      });
    }

    if (!user) {
      return res.json({
        ok: false,
        reason: "user_not_found",
      });
    }

    return res.json({
      ok: true,
      user,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      reason: "server_error",
      error: err.message,
    });
  }
});

app.post("/api/webhook/sepay", async (req, res) => {
  try {
    const body = req.body;

    console.log("SEPAY BODY:", JSON.stringify(body));

    const transactionId = String(
      body.id ||
        body.transaction_id ||
        body.referenceCode ||
        body.reference_code ||
        body.code ||
        body.gateway_transaction_id ||
        body.gatewayTransactionId ||
        body.transactionId ||
        `TX-${Date.now()}`
    );

    const amount = Number(
      body.transferAmount ||
        body.transfer_amount ||
        body.amount ||
        body.money ||
        body.value ||
        body.creditAmount ||
        body.credit_amount ||
        0
    );

    const content = String(
      body.content ||
        body.description ||
        body.transferContent ||
        body.transfer_content ||
        body.transaction_content ||
        body.note ||
        body.memo ||
        ""
    );

    const parsed = extractUser(content);

    if (!parsed) {
      return res.json({
        ok: false,
        reason: "cannot_parse_content",
        content,
        body,
      });
    }

    if (amount <= 0) {
      return res.json({
        ok: false,
        reason: "invalid_amount",
        amount,
        body,
      });
    }

    const { data: existed, error: existedError } = await supabase
      .from("deposits")
      .select("id")
      .eq("bank_transaction_id", transactionId)
      .maybeSingle();

    if (existedError) {
      return res.json({
        ok: false,
        reason: "check_duplicate_failed",
        error: existedError.message,
      });
    }

    if (existed) {
      return res.json({
        ok: true,
        duplicate: true,
        transactionId,
      });
    }

    const { data: users, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("id", parsed.userId);

    if (userError) {
      return res.json({
        ok: false,
        reason: "find_user_failed",
        error: userError.message,
        parsed,
      });
    }

    const user = users?.find(
      (u) =>
        String(u.username).toLowerCase() ===
        String(parsed.username).toLowerCase()
    );

    if (!user) {
      return res.json({
        ok: false,
        reason: "user_not_found",
        parsed,
      });
    }

    const newBalance = Number(user.balance || 0) + amount;
    const newTotalDeposit = Number(user.total_deposit || 0) + amount;

    const { error: updateError } = await supabase
      .from("users")
      .update({
        balance: newBalance,
        total_deposit: newTotalDeposit,
        last_deposit: new Date().toLocaleString("vi-VN"),
      })
      .eq("id", user.id);

    if (updateError) {
      return res.json({
        ok: false,
        reason: "update_user_failed",
        error: updateError.message,
      });
    }

    const { error: depositError } = await supabase.from("deposits").insert({
      id: `BANK-${Date.now()}`,
      user_id: user.id,
      username: user.username,
      amount,
      content,
      bank_transaction_id: transactionId,
      status: "success",
      raw: body,
    });

    if (depositError) {
      return res.json({
        ok: false,
        reason: "insert_deposit_failed",
        error: depositError.message,
      });
    }

    return res.json({
      ok: true,
      credited: amount,
      user: user.username,
      userId: user.id,
      balance: newBalance,
      totalDeposit: newTotalDeposit,
      transactionId,
    });
  } catch (err) {
    console.error("WEBHOOK ERROR:", err);

    return res.status(500).json({
      ok: false,
      reason: "server_error",
      error: err.message,
    });
  }
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`TapHoaTX API running on ${PORT}`);
});
