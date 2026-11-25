
import prisma from "../config/prisma.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// Generate JWT Token
const generateToken = (user) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.sign(
    {
      userId: user.id,
      organisationId: user.organisationId,
      role: user.role
    },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );
};

// REGISTER
export const register = async (req, res) => {
  try {
    const { name, email, password, organisationName } = req.body;

    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string" ||
      typeof organisationName !== "string" ||
      !name.trim() ||
      !email.trim() ||
      !password ||
      !organisationName.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields are required"
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address"
      });
    }

    const existingUser = await prisma.user.findFirst({
      where: { email: normalizedEmail }
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Email already registered"
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const result = await prisma.$transaction(async (tx) => {
      const organisation = await tx.organisation.create({
        data: {
          name: organisationName.trim()
        }
      });

      const user = await tx.user.create({
        data: {
          name: name.trim(),
          email: normalizedEmail,
          password: hashedPassword,
          role: "ADMIN",
          organisationId: organisation.id
        }
      });

      return { user, organisation };
    });

    const token = generateToken(result.user);

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      token,
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: result.user.role,
        organisationId: result.organisation.id
      }
    });

  } catch (error) {
    console.error("REGISTER ERROR:", error);

    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "Email already registered"
      });
    }

    return res.status(500).json({
      success: false,
      message: "Registration failed"
    });
  }
};

// LOGIN

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findFirst({
      where: {
        email: normalizedEmail
      }
    });

    if (!user || !user.password) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const passwordMatch = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        organisationId: user.organisationId
      }
    });

  } catch (error) {
    console.error("Staff login failed:", {
      name: error?.name,
      code: error?.code,
      message: error?.message,
    });

    return res.status(500).json({
      success: false,
      message: "Login failed. Please try again later."
    });
  }
};
