import AppError from "../utils/AppError.js";
const validate = (schema, source = "body") => async (req, res, next) => {
    try {
        const value = await schema.validate(req[source], {
            abortEarly: false,
            stripUnknown: true,
        });
        if (source === "body") {
            req.body = value;
        }
        else if (source === "query") {
            res.locals.query = value;
        }
        next();
    }
    catch (error) {
        const message = error.errors.join(", ");
        next(new AppError(message, 400));
    }
};
export default validate;
