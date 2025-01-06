import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import readline from "node:readline";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";

const execAsync = promisify(exec);

function question(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    }),
  );
}

async function checkStripeCLI() {
  console.log(
    "Step 1: Checking if Stripe CLI is installed and authenticated...",
  );
  try {
    await execAsync("stripe --version");
    console.log("Stripe CLI is installed.");

    // Check if Stripe CLI is authenticated
    try {
      await execAsync("stripe config --list");
      console.log("Stripe CLI is authenticated.");
    } catch (error) {
      console.log(
        "Stripe CLI is not authenticated or the authentication has expired.",
      );
      console.log("Please run: stripe login");
      const answer = await question(
        "Have you completed the authentication? (y/n): ",
      );
      if (answer.toLowerCase() !== "y") {
        console.log(
          "Please authenticate with Stripe CLI and run this script again.",
        );
        process.exit(1);
      }

      // Verify authentication after user confirms login
      try {
        await execAsync("stripe config --list");
        console.log("Stripe CLI authentication confirmed.");
      } catch (error) {
        console.error(
          "Failed to verify Stripe CLI authentication. Please try again.",
        );
        process.exit(1);
      }
    }
  } catch (error) {
    console.error(
      "Stripe CLI is not installed. Please install it and try again.",
    );
    console.log("To install Stripe CLI, follow these steps:");
    console.log("1. Visit: https://docs.stripe.com/stripe-cli");
    console.log(
      "2. Download and install the Stripe CLI for your operating system",
    );
    console.log("3. After installation, run: stripe login");
    console.log(
      "After installation and authentication, please run this setup script again.",
    );
    process.exit(1);
  }
}

async function checkTursoCLI() {
  console.log("Checking if Turso CLI is installed...");
  try {
    await execAsync("turso --version");
    console.log("Turso CLI is installed.");
  } catch (error) {
    console.error(
      "Turso CLI is not installed. Please install it and try again.",
    );
    console.log("To install Turso CLI, follow these steps:");
    console.log("1. Visit: https://docs.turso.tech/reference/turso-cli");
    console.log(
      "2. Follow the installation instructions for your operating system",
    );
    console.log("After installation, please run this setup script again.");
    process.exit(1);
  }
}

async function getTursoDatabaseInfo(): Promise<{
  url: string;
  isRemote: boolean;
  authToken?: string;
}> {
  console.log("Step 2: Setting up Database");
  const dbChoice = await question(
    "Do you want to use a local SQLite file (L) or a remote Turso database (R)? (L/R): ",
  );

  if (dbChoice.toLowerCase() === "l") {
    return { url: "file:dev.db", isRemote: false };
  } else {
    await checkTursoCLI();

    const dbName = await question("Enter a name for your Turso database: ");

    try {
      console.log(`Creating Turso database: ${dbName}`);
      await execAsync(`turso db create ${dbName}`);
      console.log(`Turso database '${dbName}' created successfully.`);

      const { stdout: urlOutput } = await execAsync(
        `turso db show ${dbName} --url`,
      );
      const url = urlOutput.trim();

      const authToken = await question(
        "Enter your Turso authentication token: ",
      );

      return { url, isRemote: true, authToken };
    } catch (error) {
      console.error("Failed to create Turso database:", error);
      process.exit(1);
    }
  }
}

async function getStripeSecretKey(): Promise<string> {
  console.log("Step 3: Getting Stripe Secret Key");
  console.log(
    "You can find your Stripe Secret Key at: https://dashboard.stripe.com/test/apikeys",
  );
  return await question("Enter your Stripe Secret Key: ");
}

async function createStripeWebhook(): Promise<string> {
  console.log("Step 4: Creating Stripe webhook...");
  try {
    const { stdout } = await execAsync("stripe listen --print-secret");
    const match = stdout.match(/whsec_[a-zA-Z0-9]+/);
    if (!match) {
      throw new Error("Failed to extract Stripe webhook secret");
    }
    console.log("Stripe webhook created.");
    return match[0];
  } catch (error) {
    console.error(
      "Failed to create Stripe webhook. Check your Stripe CLI installation and permissions.",
    );
    if (os.platform() === "win32") {
      console.log(
        "Note: On Windows, you may need to run this script as an administrator.",
      );
    }
    throw error;
  }
}

function generateAuthSecret(): string {
  console.log("Step 5: Generating AUTH_SECRET...");
  return crypto.randomBytes(32).toString("hex");
}

async function writeEnvFile(envVars: Record<string, string>) {
  console.log("Step 6: Writing environment variables to .env");
  const envContent = Object.entries(envVars)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  await fs.writeFile(path.join(process.cwd(), ".env"), envContent);
  console.log(".env file created with the necessary variables.");
}

async function main() {
  await checkStripeCLI();

  const {
    url: TURSO_DATABASE_URL,
    isRemote,
    authToken: TURSO_AUTH_TOKEN,
  } = await getTursoDatabaseInfo();
  const STRIPE_SECRET_KEY = await getStripeSecretKey();
  const STRIPE_WEBHOOK_SECRET = await createStripeWebhook();
  const BASE_URL = "http://localhost:3000";
  const AUTH_SECRET = generateAuthSecret();

  const envVars: Record<string, string> = {
    TURSO_DATABASE_URL,
    STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET,
    BASE_URL,
    AUTH_SECRET,
  };

  if (isRemote && TURSO_AUTH_TOKEN) {
    envVars.TURSO_AUTH_TOKEN = TURSO_AUTH_TOKEN;
  }

  console.log("🎉 Setup completed successfully!");
}

main().catch(console.error);
