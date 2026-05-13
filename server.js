import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

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

app.post("/api/webhook/sepay", async (req, res) => {
  try {
    const body = req.body;

    const transactionId = String(
      body.id ||
      Date.now()
    );

    const amount = Number(
      body.transferAmount ||
      body.amount ||
      0
    );

    const content =
      body.content ||
      body.description ||
      "";

    if (amount <= 0) {
      return res.json({
        ok: false,
      });
    }

    const parsed = extractUser(content);

    if (!parsed) {
      return res.json({
        ok: false,
      });
    }

    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("id", parsed.userId)
      .eq("username", parsed.username)
      .maybeSingle();

    if (!user) {
      return res.json({
        ok: false,
      });
    }

    await supabase
      .from("users")
      .update({
        balance: Number(user.balance) + amount,
        total_deposit:
          Number(user.total_deposit) + amount,
      })
      .eq("id", user.id);

    await supabase
      .from("deposits")
      .insert({
        id: `BANK-${Date.now()}`,
        user_id: user.id,
        username: user.username,
        amount,
        content,
        bank_transaction_id: transactionId,
        status: "success",
        raw: body,
      });

    return res.json({
      ok: true,
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      ok: false,
    });
  }
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Running on ${PORT}`);
});