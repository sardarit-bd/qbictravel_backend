import { prisma } from "../../lib/prisma.js";
import logger from "../../shared/logger/logger.js";
import { calculateCommissionAmount } from "./commissionCalculator.js";
import type {
  CommissionFilters,
  CommissionPolicyFilters,
  CommissionPolicyStatusValue,
  CommissionRateTypeValue,
} from "./commissionTypes.js";

type HistoryChanges = Record<string, string | number | boolean | null>;
type CommissionTx = Pick<typeof prisma, "booking" | "commission" | "commissionRule">;

const commissionSelect = {
  id: true,
  bookingId: true,
  agentId: true,
  ruleId: true,
  rateType: true,
  rateValue: true,
  baseAmount: true,
  amount: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  agent: { select: { id: true, name: true } },
  booking: {
    select: {
      id: true,
      serviceId: true,
      status: true,
      paymentStatus: true,
      currency: true,
      finalPrice: true,
      notes: true,
      service: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true, email: true } },
      availability: { select: { id: true, date: true } },
    },
  },
} as const;

const commissionDetailSelect = {
  ...commissionSelect,
  adjustments: {
    orderBy: { createdAt: "desc" },
    select: { id: true, previousAmount: true, newAmount: true, reason: true, adminId: true, createdAt: true },
  },
} as const;

const ruleSelect = {
  id: true,
  name: true,
  description: true,
  rateType: true,
  rateValue: true,
  status: true,
  isActive: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ruleDetailSelect = {
  ...ruleSelect,
  createdBy: { select: { id: true, name: true, email: true } },
  auditLogs: {
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      ruleId: true,
      adminId: true,
      action: true,
      previousValues: true,
      newValues: true,
      createdAt: true,
      admin: { select: { id: true, name: true, email: true } },
    },
  },
} as const;

export const listCommissions = async (filters: CommissionFilters, skip: number, take: number) => {
  const where = {
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
    ...(filters.bookingId ? { bookingId: filters.bookingId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.commission.findMany({
      where,
      select: commissionSelect,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.commission.count({ where }),
  ]);

  return { items, total };
};

export const findCommissionById = async (commissionId: string) => {
  return prisma.commission.findUnique({
    where: { id: commissionId },
    select: commissionDetailSelect,
  });
};

export const findActiveRule = async () => {
  return prisma.commissionRule.findFirst({
    where: { isActive: true, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: ruleSelect,
  });
};

export const findRuleById = async (ruleId: string) => {
  return prisma.commissionRule.findUnique({
    where: { id: ruleId },
    select: ruleDetailSelect,
  });
};

export const countCommissionsByRuleId = async (ruleId: string) => {
  return prisma.commission.count({ where: { ruleId } });
};

export const listRules = async (skip: number, take: number, filters?: CommissionPolicyFilters) => {
  const where = {
    ...(filters?.status ? { status: filters.status } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.commissionRule.findMany({
      where,
      select: ruleDetailSelect,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.commissionRule.count({ where }),
  ]);

  return { items, total };
};

export const createCommissionRule = async (params: {
  name: string;
  description?: string;
  rateType: CommissionRateTypeValue;
  rateValue: number;
  status?: CommissionPolicyStatusValue;
  isActive?: boolean;
  adminId: string;
}) => {
  return prisma.$transaction(
    async (tx) => {
      const willBeActive = params.isActive || params.status === "ACTIVE";

      if (willBeActive) {
        // Deactivate all currently active rules atomically
        const currentActives = await tx.commissionRule.findMany({
          where: { isActive: true },
          select: { id: true, name: true, rateType: true, rateValue: true, status: true },
        });

        for (const current of currentActives) {
          await tx.commissionRule.update({
            where: { id: current.id },
            data: { isActive: false, status: "INACTIVE" },
          });

          await tx.commissionRuleAuditLog.create({
            data: {
              ruleId: current.id,
              adminId: params.adminId,
              action: "COMMISSION_DEACTIVATED",
              previousValues: {
                name: current.name,
                status: current.status,
                isActive: true,
                rateType: current.rateType,
                rateValue: Number(current.rateValue),
              },
              newValues: {
                status: "INACTIVE",
                isActive: false,
              },
            },
          });
        }
      }

      const rule = await tx.commissionRule.create({
        data: {
          name: params.name,
          description: params.description || null,
          rateType: params.rateType,
          rateValue: params.rateValue,
          status: willBeActive ? "ACTIVE" : "INACTIVE",
          isActive: willBeActive,
          createdById: params.adminId,
        },
        select: ruleDetailSelect,
      });

      await tx.commissionRuleAuditLog.create({
        data: {
          ruleId: rule.id,
          adminId: params.adminId,
          action: "COMMISSION_CREATED",
          newValues: {
            name: rule.name,
            description: rule.description,
            rateType: rule.rateType,
            rateValue: Number(rule.rateValue),
            status: rule.status,
            isActive: rule.isActive,
          },
        },
      });

      return rule;
    },
    { isolationLevel: "Serializable" }
  );
};

export const updateCommissionRule = async (params: {
  ruleId: string;
  adminId: string;
  name?: string;
  description?: string;
  rateType?: CommissionRateTypeValue;
  rateValue?: number;
  status?: CommissionPolicyStatusValue;
  isActive?: boolean;
  previousValues: Record<string, unknown>;
}) => {
  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.commissionRule.findUniqueOrThrow({
        where: { id: params.ruleId },
      });

      const willBeActive = params.isActive !== undefined ? params.isActive : (params.status ? params.status === "ACTIVE" : existing.isActive);

      if (willBeActive && !existing.isActive) {
        // Deactivate all other active rules
        const otherActives = await tx.commissionRule.findMany({
          where: { isActive: true, id: { not: params.ruleId } },
          select: { id: true, name: true, rateType: true, rateValue: true, status: true },
        });

        for (const other of otherActives) {
          await tx.commissionRule.update({
            where: { id: other.id },
            data: { isActive: false, status: "INACTIVE" },
          });

          await tx.commissionRuleAuditLog.create({
            data: {
              ruleId: other.id,
              adminId: params.adminId,
              action: "COMMISSION_DEACTIVATED",
              previousValues: {
                name: other.name,
                status: other.status,
                isActive: true,
                rateType: other.rateType,
                rateValue: Number(other.rateValue),
              },
              newValues: {
                status: "INACTIVE",
                isActive: false,
                replacedByRuleId: params.ruleId,
              },
            },
          });
        }
      }

      const updated = await tx.commissionRule.update({
        where: { id: params.ruleId },
        data: {
          ...(params.name !== undefined ? { name: params.name } : {}),
          ...(params.description !== undefined ? { description: params.description } : {}),
          ...(params.rateType !== undefined ? { rateType: params.rateType } : {}),
          ...(params.rateValue !== undefined ? { rateValue: params.rateValue } : {}),
          ...(willBeActive ? { isActive: true, status: "ACTIVE" } : { isActive: false, status: "INACTIVE" }),
        },
        select: ruleDetailSelect,
      });

      await tx.commissionRuleAuditLog.create({
        data: {
          ruleId: params.ruleId,
          adminId: params.adminId,
          action: "COMMISSION_UPDATED",
          previousValues: params.previousValues as any,
          newValues: {
            name: updated.name,
            description: updated.description,
            rateType: updated.rateType,
            rateValue: Number(updated.rateValue),
            status: updated.status,
            isActive: updated.isActive,
          },
        },
      });

      return updated;
    },
    { isolationLevel: "Serializable" }
  );
};

export const deleteCommissionRule = async (params: {
  ruleId: string;
  adminId: string;
  previousValues: Record<string, unknown>;
}) => {
  return prisma.$transaction(async (tx) => {
    await tx.commissionRuleAuditLog.create({
      data: {
        ruleId: params.ruleId,
        adminId: params.adminId,
        action: "COMMISSION_DELETED",
        previousValues: params.previousValues as any,
      },
    });

    await tx.commissionRule.delete({
      where: { id: params.ruleId },
    });

    return { id: params.ruleId, deleted: true };
  });
};

export const publishPolicy = async (params: {
  ruleId: string;
  adminId: string;
  previousValues: Record<string, unknown>;
}) => {
  return prisma.$transaction(
    async (tx) => {
      // Find currently active rules to safely deactivate
      const activeRules = await tx.commissionRule.findMany({
        where: { isActive: true },
        select: { id: true, rateType: true, rateValue: true, status: true },
      });

      for (const prevActive of activeRules) {
        if (prevActive.id === params.ruleId) continue;
        await tx.commissionRule.update({
          where: { id: prevActive.id },
          data: { isActive: false, status: "INACTIVE" },
        });

        await tx.commissionRuleAuditLog.create({
          data: {
            ruleId: prevActive.id,
            adminId: params.adminId,
            action: "POLICY_DEACTIVATED",
            previousValues: {
              status: prevActive.status,
              isActive: true,
              rateType: prevActive.rateType,
              rateValue: Number(prevActive.rateValue),
            },
            newValues: {
              status: "INACTIVE",
              isActive: false,
              deactivatedByPolicyId: params.ruleId,
            },
          },
        });
      }

      // Now activate the target rule
      const published = await tx.commissionRule.update({
        where: { id: params.ruleId },
        data: { isActive: true, status: "ACTIVE" },
        select: ruleDetailSelect,
      });

      await tx.commissionRuleAuditLog.create({
        data: {
          ruleId: params.ruleId,
          adminId: params.adminId,
          action: "POLICY_PUBLISHED",
          previousValues: params.previousValues as any,
          newValues: {
            status: "ACTIVE",
            isActive: true,
            rateType: published.rateType,
            rateValue: Number(published.rateValue),
          },
        },
      });

      return published;
    },
    { isolationLevel: "Serializable" }
  );
};

export const deactivatePolicy = async (params: {
  ruleId: string;
  adminId: string;
  previousValues: Record<string, unknown>;
}) => {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.commissionRule.update({
      where: { id: params.ruleId },
      data: { isActive: false, status: "INACTIVE" },
      select: ruleDetailSelect,
    });

    await tx.commissionRuleAuditLog.create({
      data: {
        ruleId: params.ruleId,
        adminId: params.adminId,
        action: "POLICY_DEACTIVATED",
        previousValues: params.previousValues as any,
        newValues: {
          status: "INACTIVE",
          isActive: false,
        },
      },
    });

    return updated;
  });
};

export const archivePolicy = async (params: {
  ruleId: string;
  adminId: string;
  previousValues: Record<string, unknown>;
}) => {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.commissionRule.update({
      where: { id: params.ruleId },
      data: { isActive: false, status: "ARCHIVED" },
      select: ruleDetailSelect,
    });

    await tx.commissionRuleAuditLog.create({
      data: {
        ruleId: params.ruleId,
        adminId: params.adminId,
        action: "POLICY_ARCHIVED",
        previousValues: params.previousValues as any,
        newValues: {
          status: "ARCHIVED",
          isActive: false,
        },
      },
    });

    return updated;
  });
};

export const deleteDraftPolicy = async (params: {
  ruleId: string;
  adminId: string;
  previousValues: Record<string, unknown>;
}) => {
  return prisma.$transaction(async (tx) => {
    // Audit log before deletion
    await tx.commissionRuleAuditLog.create({
      data: {
        ruleId: params.ruleId,
        adminId: params.adminId,
        action: "POLICY_DELETED",
        previousValues: params.previousValues as any,
      },
    });

    await tx.commissionRule.delete({
      where: { id: params.ruleId },
    });

    return { id: params.ruleId, deleted: true };
  });
};

export const createRevisionFromPolicy = async (params: {
  sourceRuleId: string;
  adminId: string;
  rateType?: CommissionRateTypeValue;
  rateValue?: number;
  sourcePolicy: { rateType: CommissionRateTypeValue; rateValue: number | any };
}) => {
  return prisma.$transaction(async (tx) => {
    const newRateType = params.rateType || params.sourcePolicy.rateType;
    const newRateValue = params.rateValue !== undefined ? params.rateValue : Number(params.sourcePolicy.rateValue);

    const newRule = await tx.commissionRule.create({
      data: {
        rateType: newRateType,
        rateValue: newRateValue,
        status: "DRAFT",
        isActive: false,
        createdById: params.adminId,
      },
      select: ruleDetailSelect,
    });

    await tx.commissionRuleAuditLog.create({
      data: {
        ruleId: newRule.id,
        adminId: params.adminId,
        action: "POLICY_REVISION_CREATED",
        previousValues: {
          sourceRuleId: params.sourceRuleId,
          rateType: params.sourcePolicy.rateType,
          rateValue: Number(params.sourcePolicy.rateValue),
        },
        newValues: {
          rateType: newRule.rateType,
          rateValue: Number(newRule.rateValue),
          status: newRule.status,
          revisionOfRuleId: params.sourceRuleId,
        },
      },
    });

    return newRule;
  });
};

export const replaceActiveRule = async (params: {
  rateType: CommissionRateTypeValue;
  rateValue: number;
  adminId: string;
}) => {
  return prisma.$transaction(
    async (tx) => {
      // Find currently active rules
      const activeRules = await tx.commissionRule.findMany({
        where: { isActive: true },
        select: { id: true, rateType: true, rateValue: true, status: true },
      });

      for (const prevActive of activeRules) {
        await tx.commissionRule.update({
          where: { id: prevActive.id },
          data: { isActive: false, status: "INACTIVE" },
        });

        await tx.commissionRuleAuditLog.create({
          data: {
            ruleId: prevActive.id,
            adminId: params.adminId,
            action: "POLICY_DEACTIVATED",
            previousValues: {
              status: prevActive.status,
              isActive: true,
              rateType: prevActive.rateType,
              rateValue: Number(prevActive.rateValue),
            },
            newValues: {
              status: "INACTIVE",
              isActive: false,
            },
          },
        });
      }

      const created = await tx.commissionRule.create({
        data: {
          name: params.rateType === "PERCENTAGE" ? `${params.rateValue}% Platform Commission` : `฿${params.rateValue} Fixed Commission`,
          rateType: params.rateType,
          rateValue: params.rateValue,
          status: "ACTIVE",
          isActive: true,
          createdById: params.adminId,
        },
        select: ruleDetailSelect,
      });

      await tx.commissionRuleAuditLog.create({
        data: {
          ruleId: created.id,
          adminId: params.adminId,
          action: "POLICY_PUBLISHED",
          newValues: {
            status: "ACTIVE",
            isActive: true,
            rateType: created.rateType,
            rateValue: Number(created.rateValue),
          },
        },
      });

      return created;
    },
    { isolationLevel: "Serializable" },
  );
};

export const disableActiveCommission = async (adminId: string) => {
  return prisma.$transaction(
    async (tx) => {
      const activeRules = await tx.commissionRule.findMany({
        where: { isActive: true },
        select: { id: true, rateType: true, rateValue: true, status: true },
      });

      for (const prevActive of activeRules) {
        await tx.commissionRule.update({
          where: { id: prevActive.id },
          data: { isActive: false, status: "INACTIVE" },
        });

        await tx.commissionRuleAuditLog.create({
          data: {
            ruleId: prevActive.id,
            adminId,
            action: "COMMISSION_DISABLED",
            previousValues: {
              status: prevActive.status,
              isActive: true,
              rateType: prevActive.rateType,
              rateValue: Number(prevActive.rateValue),
            },
            newValues: {
              status: "INACTIVE",
              isActive: false,
            },
          },
        });
      }

      return { disabled: true, deactivatedCount: activeRules.length };
    },
    { isolationLevel: "Serializable" },
  );
};

export const adjustCommission = async (params: {
  commissionId: string;
  bookingId: string;
  adminId: string;
  previousAmount: number;
  newAmount: number;
  reason: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.commission.updateMany({
      where: { id: params.commissionId, status: "ACTIVE", amount: params.previousAmount },
      data: { amount: params.newAmount },
    });

    if (updated.count === 0) {
      return null;
    }

    await tx.commissionAdjustment.create({
      data: {
        commissionId: params.commissionId,
        adminId: params.adminId,
        previousAmount: params.previousAmount,
        newAmount: params.newAmount,
        reason: params.reason,
      },
    });

    const changes: HistoryChanges = {
      commissionId: params.commissionId,
      previousAmount: params.previousAmount,
      newAmount: params.newAmount,
      reason: params.reason,
    };

    await tx.bookingHistory.create({
      data: {
        bookingId: params.bookingId,
        actorId: params.adminId,
        actorRole: "admin",
        action: "COMMISSION_ADJUSTED",
        changes,
      },
    });

    return tx.commission.findUniqueOrThrow({
      where: { id: params.commissionId },
      select: commissionDetailSelect,
    });
  });
};

/**
 * Called inside the payment verification transaction. Creates one commission per
 * booking when the booking has an agent and an active commission rule exists.
 */
export const createCommissionForBooking = async (tx: CommissionTx, bookingId: string) => {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, agentId: true, finalPrice: true },
  });

  if (!booking || !booking.agentId) {
    return null;
  }

  const existing = await tx.commission.findUnique({ where: { bookingId }, select: { id: true } });
  if (existing) {
    return null;
  }

  // Must find currently ACTIVE policy
  const rule = await tx.commissionRule.findFirst({
    where: { isActive: true, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });

  if (!rule) {
    logger.warn({ bookingId }, "No active commission rule; commission was not created");
    return null;
  }

  const baseAmount = Number(booking.finalPrice);
  const amount = calculateCommissionAmount(rule.rateType, Number(rule.rateValue), baseAmount);

  return tx.commission.create({
    data: {
      bookingId,
      agentId: booking.agentId,
      ruleId: rule.id,
      rateType: rule.rateType,
      rateValue: rule.rateValue,
      baseAmount,
      amount,
    },
  });
};
