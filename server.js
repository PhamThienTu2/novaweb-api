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

  return {
    userId: match[1],
    username: match[2],
  };
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    app: "NovaWeb API",
  });
});

app.get("/api/webhook/sepay", (req, res) => {
  res.json({
    ok: true,
    message: "Webhook endpoint is ready. Use POST.",
  });
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
      Date.now()
    );

    const amount = Number(
      body.transferAmount ||
      body.transfer_amount ||
      body.amount ||
      body.money ||
      body.value ||
      0
    );

    const content = String(
      body.content ||
      body.description ||
      body.transferContent ||
      body.transfer_content ||
      body.transaction_content ||
      body.note ||
      ""
    );

    if (amount <= 0) {
      return res.json({
        ok: false,
        reason: "invalid_amount",
        body,
      });
    }

    const parsed = extractUser(content);

    if (!parsed) {
      return res.json({
        ok: false,
        reason: "cannot_parse_user",
        content,
        body,
      });
    }

    const { data: existed } = await supabase
      .from("deposits")
      .select("id")
      .eq("bank_transaction_id", transactionId)
      .maybeSingle();

    if (existed) {
      return res.json({
        ok: true,
        duplicate: true,
      });
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("id", parsed.userId)
      .eq("username", parsed.username)
      .maybeSingle();

    if (userError) {
      return res.json({
        ok: false,
        reason: "supabase_user_error",
        error: userError.message,
      });
    }

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
        reason: "update_user_error",
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
        reason: "insert_deposit_error",
        error: depositError.message,
      });
    }

    return res.json({
      ok: true,
      credited: amount,
      user: user.username,
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
  console.log(`Running on ${PORT}`);
});
