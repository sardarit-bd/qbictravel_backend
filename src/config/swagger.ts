import swaggerJsdoc from "swagger-jsdoc";

const errorResponse = (description: string) => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorResponse" },
    },
  },
});

const envelope = (data: Record<string, unknown>) => ({
  type: "object",
  properties: {
    success: { type: "boolean", example: true },
    message: { type: "string" },
    data,
  },
});

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Express API",
      version: "1.0.0",
      description: "Express API Documentation",
    },
    servers: [
      {
        url: "http://localhost:5000",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        cookieAuth: { type: "apiKey", in: "cookie", name: "token" },
      },
      parameters: {
        PageParam: {
          name: "page",
          in: "query",
          schema: { type: "integer", minimum: 1, default: 1 },
        },
        LimitParam: {
          name: "limit",
          in: "query",
          schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        },
        SearchParam: {
          name: "search",
          in: "query",
          description: "Case-insensitive match on name or email",
          schema: { type: "string", maxLength: 100 },
        },
        StatusParam: {
          name: "status",
          in: "query",
          schema: { type: "string", enum: ["active", "deactivated"] },
        },
                ReportFromParam: {
          name: "from",
          in: "query",
          description: "Start of range (ISO date or date-time), applied to the booking creation date",
          schema: { type: "string" },
        },
        ReportToParam: {
          name: "to",
          in: "query",
          description: "End of range (ISO date or date-time). A date-only value includes the whole day.",
          schema: { type: "string" },
        },
        ReportBookingStatusParam: {
          name: "status",
          in: "query",
          schema: {
            type: "string",
            enum: ["PENDING", "CONFIRMED", "CANCELLED", "AWAITING_APPROVAL", "IN_PROGRESS", "COMPLETED", "FAILED"],
          },
        },
        ReportServiceTypeParam: {
          name: "serviceType",
          in: "query",
          description: "Service category (must match an existing service type)",
          schema: { type: "string" },
        },
        ReportAgentIdParam: {
          name: "agentId",
          in: "query",
          schema: { type: "string", format: "uuid" },
        },
      },
      responses: {
        ValidationError: errorResponse("Validation error"),
        Unauthorized: errorResponse("Missing, invalid or expired authentication"),
        Forbidden: errorResponse(
          "Not allowed (insufficient role or deactivated account)",
        ),
        NotFound: errorResponse("Resource not found"),
        Conflict: errorResponse("Email already registered"),
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            message: { type: "string" },
            data: { type: "object", nullable: true, example: null },
          },
        },
        PaginationMeta: {
          type: "object",
          properties: {
            page: { type: "integer", example: 1 },
            limit: { type: "integer", example: 20 },
            total: { type: "integer", example: 42 },
            totalPages: { type: "integer", example: 3 },
          },
        },
        AuthUser: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            email: { type: "string", format: "email" },
            role: {
              type: "string",
              enum: ["customer", "agent", "staff", "admin"],
            },
          },
        },
        UserProfile: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            email: { type: "string", format: "email" },
            phone: { type: "string", nullable: true },
            role: {
              type: "string",
              enum: ["customer", "agent", "staff", "admin"],
            },
            status: { type: "string", enum: ["active", "deactivated"] },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        AdminUser: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            email: { type: "string", format: "email" },
            phone: { type: "string", nullable: true },
            role: {
              type: "string",
              enum: ["customer", "agent", "staff", "admin"],
            },
            status: { type: "string", enum: ["active", "deactivated"] },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            agentProfile: {
              type: "object",
              nullable: true,
              properties: {
                agencyName: { type: "string", nullable: true },
              },
            },
          },
        },
        MessageResponse: envelope({ type: "object", nullable: true, example: null }),
        AuthUserResponse: envelope({ $ref: "#/components/schemas/AuthUser" }),
        UserProfileResponse: envelope({ $ref: "#/components/schemas/UserProfile" }),
        AdminUserResponse: envelope({ $ref: "#/components/schemas/AdminUser" }),
        AdminUserListResponse: envelope({
          type: "object",
          properties: {
            items: {
              type: "array",
              items: { $ref: "#/components/schemas/AdminUser" },
            },
            pagination: { $ref: "#/components/schemas/PaginationMeta" },
          },
        }),
      },
    },
  },

  apis: ["./src/modules/**/*.ts"],

  failOnErrors: true,
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;