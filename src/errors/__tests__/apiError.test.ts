import { SupraAPIError } from "../apiError";

describe("SupraAPIError", () => {
    it("should set name to SupraAPIError", () => {
        const error = new SupraAPIError({
            status: 400,
            statusText: "Bad Request",
            url: "https://example.com/api",
        });
        expect(error.name).toBe("SupraAPIError");
    });

    it("should set status, statusText, url correctly", () => {
        const error = new SupraAPIError({
            status: 404,
            statusText: "Not Found",
            url: "https://example.com/api/accounts/0x1",
        });
        expect(error.status).toBe(404);
        expect(error.statusText).toBe("Not Found");
        expect(error.url).toBe("https://example.com/api/accounts/0x1");
    });

    it("should set data when provided", () => {
        const data = { error: "some detail" };
        const error = new SupraAPIError({
            status: 500,
            statusText: "Internal Server Error",
            url: "https://example.com",
            data,
        });
        expect(error.data).toBe(data);
    });

    it("should extract major_status from data.message", () => {
        const error = new SupraAPIError({
            status: 400,
            statusText: "Bad Request",
            url: "https://example.com",
            data: {
                message: "VMError with major_status: ABORTED and sub_status: 1",
            },
        });
        expect(error.major_status).toBe("ABORTED");
    });

    it('should set major_status to "unknown" when no message', () => {
        const error = new SupraAPIError({
            status: 400,
            statusText: "Bad Request",
            url: "https://example.com",
        });
        expect(error.major_status).toBe("unknown");
    });

    it('should set major_status to "unknown" when message has no major_status', () => {
        const error = new SupraAPIError({
            status: 400,
            statusText: "Bad Request",
            url: "https://example.com",
            data: { message: "Some other error message" },
        });
        expect(error.major_status).toBe("unknown");
    });

    it("should extend Error", () => {
        const error = new SupraAPIError({
            status: 400,
            statusText: "Bad Request",
            url: "https://example.com",
        });
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe("Bad Request");
    });

    it("should serialize to JSON correctly", () => {
        const error = new SupraAPIError({
            status: 400,
            statusText: "Bad Request",
            url: "https://example.com",
            data: { message: "major_status: ABORTED" },
        });
        const json = error.toJSON();
        expect(json).toEqual({
            name: "SupraAPIError",
            status: 400,
            statusText: "Bad Request",
            url: "https://example.com",
            data: { message: "major_status: ABORTED" },
            major_status: "ABORTED",
        });
    });
});
