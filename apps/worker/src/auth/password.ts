import bcrypt from "bcryptjs";

/* ========================================
   PASSWORD CONFIGURATION
======================================== */

const SALT_ROUNDS = 12;

/* ========================================
   HASH PASSWORD
======================================== */

export async function hashPassword(
  password: string
): Promise<string> {
  if (!password || password.length < 8) {
    throw new Error(
      "Password must contain at least 8 characters."
    );
  }

  return bcrypt.hash(
    password,
    SALT_ROUNDS
  );
}

/* ========================================
   VERIFY PASSWORD
======================================== */

export async function verifyPassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  if (!password || !passwordHash) {
    return false;
  }

  return bcrypt.compare(
    password,
    passwordHash
  );
}