export type PasswordHasher = {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
};

export type PasswordPolicy = {
  readonly minLength?: number;
  readonly maxLength?: number;
};

export type BunPasswordOptions = {
  readonly algorithm?: "argon2id" | "bcrypt";
  readonly memoryCost?: number;
  readonly timeCost?: number;
  readonly cost?: number;
};

export type PasswordService = {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
};

/** Wrap Bun's password API with a consistent application password policy. */
export function bunPasswordHasher(options: BunPasswordOptions = {}): PasswordHasher {
  const algorithm = options.algorithm ?? "argon2id";
  return {
    hash(password) {
      if (algorithm === "bcrypt") {
        return Bun.password.hash(password, { algorithm, cost: options.cost });
      }
      return Bun.password.hash(password, {
        algorithm,
        memoryCost: options.memoryCost,
        timeCost: options.timeCost,
      });
    },
    verify(password, hash) {
      return Bun.password.verify(password, hash);
    },
  };
}

/** Apply length checks and normalize invalid stored hashes to a failed login. */
export function passwordService(
  hasher: PasswordHasher,
  policy: PasswordPolicy = {},
): PasswordService {
  const minLength = policy.minLength ?? 12;
  const maxLength = policy.maxLength ?? 1_024;
  if (!Number.isInteger(minLength) || minLength < 1) throw new Error("password minLength must be a positive integer");
  if (!Number.isInteger(maxLength) || maxLength < minLength) {
    throw new Error("password maxLength must be at least minLength");
  }

  return {
    async hash(password) {
      validatePassword(password, minLength, maxLength);
      return hasher.hash(password);
    },
    async verify(password, hash) {
      if (!isPasswordInRange(password, minLength, maxLength) || !hash || hash.length > 2_048) return false;
      try {
        return await hasher.verify(password, hash);
      } catch {
        return false;
      }
    },
  };
}

function validatePassword(password: string, minLength: number, maxLength: number) {
  if (!isPasswordInRange(password, minLength, maxLength)) {
    throw new Error(`password must contain between ${minLength} and ${maxLength} characters`);
  }
}

function isPasswordInRange(password: string, minLength: number, maxLength: number) {
  return typeof password === "string" && password.length >= minLength && password.length <= maxLength;
}
