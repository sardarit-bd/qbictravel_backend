import { Request, Response, NextFunction } from "express";
import { AnySchema } from "yup";
import AppError from "../utils/AppError.js";

type ValidationSource = "body" | "query" | "params";

const validate =
  (schema: AnySchema, source: ValidationSource = "body") =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const value = await schema.validate(req[source], {
        abortEarly: false,
        stripUnknown: true,
      });

      if (source === "body") {
        req.body = value;
      } else if (source === "query") {
        res.locals.query = value;
      }

      next();
    } catch (error: any) {
      const message: string = error.errors.join(", ");
      next(new AppError(message, 400));
    }
  };

export default validate;