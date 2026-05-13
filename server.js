import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function extractUser(content = "") {
  const match = content.match(/NAP\s+(U\d+)\s+([a-zA-Z0-9_]+)/i);
  if (!match) return null;
  return { userId: match[1], username: match[2] };
}

app.get("/", (req, res) => {
  res.json({ ok: true, app: "TapHoaTX API" });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  const { data: user, error } = await supabase
    .from("users")
    .select("*")
    .eq("username", username)
    .eq("password", password)
    .maybeSingle();

  if (error || !user) {
    return res.json({ ok: false, message: "Sai tài khoản hoặc mật khẩu" });
  }

  res.json({ ok: true, user });
});

app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.json({ ok: false, message: "Thiếu thông tin" });
  }

  const id = `U${Date.now().toString().slice(-6)}`;

  const { data, error } = await supabase
    .from("users")
    .insert({
      id,
      username,
      password,
      name: "User mới",
      role: "user",
      balance: 0,
      total_deposit: 0,
      last_deposit: "-"
    })
    .select()
    .single();

  if (error) {
    return res.json({ ok: false, message: error.message });
  }

  res.json({ ok: true, user: data });
});

app.get("/api/user/:id", async (req, res) => {
  const { data: user, error } = await supabase
    .from("users")
    .select("id, username, name, role, balance, total_deposit, last_deposit, created_at")
    .eq("id", req.params.id)
    .maybeSingle();

  if (error || !user) {
    return res.json({ ok: false, message: "Không tìm thấy user" });
  }

  res.json({ ok: true, user });
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
      Date.now()
    );

    const amount = Number(
      body.transferAmount ||
      body.transfer_amount ||
      body.amount ||
      body.money ||
      0
    );

    const content = String(
      body.content ||
      body.description ||
      body.transferContent ||
      body.transfer_content ||
      ""
    );

    if (amount <= 0) {
      return res.json({ ok: false, reason: "invalid_amount" });
    }

    const parsed = extractUser(content);

    if (!parsed) {
      return res.json({ ok: false, reason: "cannot_parse_user", content });
    }

    const { data: existed } = await supabase
      .from("deposits")
      .select("id")
      .eq("bank_transaction_id", transactionId)
      .maybeSingle();

    if (existed) {
      return res.json({ ok: true, duplicate: true });
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("id", parsed.userId)
      .eq("username", parsed.username)
      .maybeSingle();

    if (userError || !user) {
      return res.json({
        ok: false,
        reason: "user_not_found",
        error: userError?.message,
        parsed
      });
    }

    const newBalance = Number(user.balance || 0) + amount;
    const newTotalDeposit = Number(user.total_deposit || 0) + amount;

    await supabase
      .from("users")
      .update({
        balance: newBalance,
        total_deposit: newTotalDeposit,
        last_deposit: new Date().toLocaleString("vi-VN")
      })
      .eq("id", user.id);

    await supabase.from("deposits").insert({
      id: `BANK-${Date.now()}`,
      user_id: user.id,
      username: user.username,
      amount,
      content,
      bank_transaction_id: transactionId,
      status: "success",
      raw: body
    });

    return res.json({
      ok: true,
      credited: amount,
      user: user.username
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      ok: false,
      reason: "server_error",
      error: err.message
    });
  }
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`TapHoaTX API running on ${PORT}`);
});
