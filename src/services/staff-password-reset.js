const passwordCharacterClasses = [
  /\p{Ll}/u,
  /\p{Lu}/u,
  /\p{N}/u,
  /[^\p{L}\p{N}\s]/u
];

export const getStaffPasswordResetValidationError = (password, confirmation) => {
  if (typeof password !== "string" || password.length < 12) {
    return "Use at least 12 characters for your new password.";
  }
  if (new TextEncoder().encode(password).length > 72) {
    return "Your new password must fit within 72 UTF-8 bytes.";
  }
  if (
    passwordCharacterClasses.filter((characterClass) => characterClass.test(password))
      .length < 3
  ) {
    return "Use at least three character types: lowercase, uppercase, numbers, or symbols.";
  }
  if (password !== confirmation) {
    return "New password and confirmation do not match.";
  }
  return "";
};
