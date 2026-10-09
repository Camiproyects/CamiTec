const crypto = require("crypto");

const password = process.argv[2];

if (!password) {
    console.log("Uso: node generar-password.js TU_CONTRASEÑA");
    process.exit(1);
}

if (password.length < 12) {
    console.log("La contraseña debe tener mínimo 12 caracteres.");
    process.exit(1);
}

const salt = crypto.randomBytes(16).toString("hex");

const hash = crypto.scryptSync(
    password,
    salt,
    64
).toString("hex");

console.log("\nHash para .env:\n");
console.log(`scrypt:${salt}:${hash}`);