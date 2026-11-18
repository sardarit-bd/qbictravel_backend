import { prisma } from "../../lib/prisma.js";
import AppError from "../../shared/utils/AppError.js";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

export interface ResolveCustomerInput {
  customerId?: string;
  customer?: {
    name: string;
    email: string;
    phone?: string | null;
  };
}

export interface ResolvedCustomer {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

/**
 * Resolves an existing active customer by ID or resolves/creates a guest customer by email.
 * Accepts an optional transaction client (`tx`) so it can participate in an atomic caller transaction.
 * Creating a guest record creates a role="customer" record with a cryptographically
 * random password hash and DOES NOT dispatch any login invitation or account setup email.
 */
export const resolveOrCreateCustomer = async (
  input: ResolveCustomerInput,
  tx?: any
): Promise<ResolvedCustomer> => {
  const db = tx ?? prisma;

  // Option A: Existing Customer ID passed
  if (input.customerId) {
    const existing = await db.user.findUnique({
      where: { id: input.customerId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        deletedAt: true,
      },
    });

    if (!existing) {
      throw new AppError("Customer not found", 404);
    }
    if (existing.role !== "customer") {
      throw new AppError("The selected account is not a customer", 409);
    }
    if (existing.status !== "active" || existing.deletedAt !== null) {
      throw new AppError("This customer account is inactive", 409);
    }

    return {
      id: existing.id,
      name: existing.name,
      email: existing.email,
      phone: existing.phone,
    };
  }

  // Option B: Inline customer details passed
  if (input.customer) {
    const email = input.customer.email.trim().toLowerCase();
    const name = input.customer.name.trim();
    const phone = input.customer.phone?.trim() || null;

    const existing = await db.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        deletedAt: true,
      },
    });

    if (existing) {
      if (existing.role !== "customer") {
        throw new AppError(
          "This email belongs to a non-customer account. Please enter the traveler's email address.",
          409
        );
      }
      if (existing.status !== "active" || existing.deletedAt !== null) {
        throw new AppError("This customer account is inactive.", 409);
      }

      // Update phone or name if missing or updated
      const shouldUpdate = (phone && !existing.phone) || (name && name !== existing.name);
      if (shouldUpdate) {
        const updated = await db.user.update({
          where: { id: existing.id },
          data: {
            ...(name ? { name } : {}),
            ...(phone && !existing.phone ? { phone } : {}),
          },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        });
        return updated;
      }

      return {
        id: existing.id,
        name: existing.name,
        email: existing.email,
        phone: existing.phone,
      };
    }

    // Create new guest customer account with randomized unusable password
    const randomPassword = await bcrypt.hash(randomBytes(24).toString("hex"), 10);
    const created = await db.user.create({
      data: {
        name,
        email,
        phone,
        password: randomPassword,
        role: "customer",
        status: "active",
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
      },
    });

    return created;
  }

  throw new AppError("Either customerId or customer details must be provided", 400);
};
