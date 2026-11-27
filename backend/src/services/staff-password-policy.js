export const isStrongStaffPassword = (password) => {
  if (typeof password !== "string") return false;
  const characterClasses = [
    /\p{Ll}/u,
    /\p{Lu}/u,
    /\p{N}/u,
    /[^\p{L}\p{N}\s]/u
  ];

  return (
    password.length >= 12 &&
    Buffer.byteLength(password, "utf8") <= 72 &&
    characterClasses.filter((characterClass) => characterClass.test(password)).length >= 3
  );
};
