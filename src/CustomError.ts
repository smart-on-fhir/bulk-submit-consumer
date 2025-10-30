export default class CustomError extends Error {
    context: CustomErrorContext;

    constructor(message: string, context: CustomErrorContext) {
        super(message);
        Object.setPrototypeOf(this, CustomError.prototype);
        this.context = context;
        this.name = "CustomError";
    }
}