import { expect }     from "chai";
import request        from "supertest";
import jwt            from "jsonwebtoken";
import { JWT_SECRET } from "../config";
import createApp      from "../app";
// import nock from "nock";


describe("Registration Endpoint", () => {
    
    it("should return a signed JWT when jwks_url is provided", async () => {
        const app = createApp();
        const response = await request(app)
            .post("/register")
            .set("Content-Type", "application/x-www-form-urlencoded")
            .send('jwks_url=https://example.com/jwks')
            .expect(200)
            .expect("content-type", /text\/plain/);
        const decoded = jwt.verify(response.text, JWT_SECRET);
        expect(decoded).to.have.property("jwks_url", "https://example.com/jwks");
    });

    it("should return a signed JWT when jwks is provided", async () => {
        const jwks = JSON.stringify({ keys: [{ kty: "RSA", kid: "123", n: "abc", e: "AQAB" }] });
        const app = createApp();
        const response = await request(app)
            .post("/register")
            .set("Content-Type", "application/x-www-form-urlencoded")
            .send(`jwks=${encodeURIComponent(jwks)}`)
            .expect(200)
            .expect("content-type", /text\/plain/);
        const decoded: any = jwt.verify(response.text, JWT_SECRET);
        expect(decoded).to.have.property("jwks");
        expect(decoded.jwks).to.deep.equal(JSON.parse(jwks));
    });

    it("should throw an error if neither jwks nor jwks_url is provided", async () => {
        const app = createApp();
        const response = await request(app)
            .post("/register")
            .set("Content-Type", "application/x-www-form-urlencoded")
            .send({});
        expect(response.status).to.equal(400);
        expect(response.body).to.have.property("error", "invalid_request");
        expect(response.body).to.have.property("error_description", "Either jwks or jwks_url is required");
    });

    it("should throw an error if jwks is invalid JSON", async () => {
        const app = createApp();
        const response = await request(app)
            .post("/register")
            .set("Content-Type", "application/x-www-form-urlencoded")
            .send(`jwks=${encodeURIComponent("invalid-json")}`)
            .expect(400)
            .expect("content-type", /json/);
        expect(response.body).to.have.property("error", "invalid_request");
        expect(response.body).to.have.property("error_description").that.matches(/Cannot parse jwks as JSON/);
        // expect(response.body).to.have.property("error_description", "Cannot parse jwks as JSON");
    });
});

describe("Token Endpoint", () => {
    // it("should return an access token for valid client_assertion and scope", async () => {
    //     const clientAssertion = jwt.sign({
    //         sub: "client-id",
    //         iss: "client-id",
    //         aud: "http://localhost/token",
    //         exp: Math.floor(Date.now() / 1000) + 300
    //     }, JWT_SECRET, { algorithm: "HS256" });

    //     const response = await request(app)
    //         .post("/token")
    //         .set("Content-Type", "application/x-www-form-urlencoded")
    //         .send({
    //             grant_type: "client_credentials",
    //             client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    //             client_assertion: clientAssertion,
    //             scope: "read write"
    //         });

    //     expect(response.status).to.equal(200);
    //     expect(response.body).to.have.property("access_token");
    //     expect(response.body).to.have.property("token_type", "bearer");
    //     expect(response.body).to.have.property("expires_in");
    //     expect(response.body).to.have.property("scope", "read write");
    // });

    it("should return an error for missing client_assertion", async () => {
        const app = createApp();
        const response = await request(app)
            .post("/token")
            .set("Content-Type", "application/x-www-form-urlencoded")
            .send({
                grant_type: "client_credentials",
                client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                scope: "read write"
            });
        expect(response.status).to.equal(400);
        expect(response.body).to.have.property("error", "invalid_request");
        expect(response.body).to.have.property("error_description", "Missing client_assertion parameter");
    });

    it("should return an error for invalid client_assertion", async () => {
        const app = createApp();
        const response = await request(app)
            .post("/token")
            .set("Content-Type", "application/x-www-form-urlencoded")
            .send({
                grant_type: "client_credentials",
                client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                client_assertion: "invalid-token",
                scope: "read write"
            });
        expect(response.status).to.equal(400);
        expect(response.body).to.have.property("error", "invalid_request");
        expect(response.body).to.have.property("error_description", "Invalid registration token");
    });

    it("should return an error for invalid scope", async () => {
        const app     = createApp();
        const server  = app.listen(0); // Bind to a random available port
        const address = server.address();
        const baseUrl = `http://127.0.0.1:${(address as any).port}`;
        // console.log(baseUrl);

        // nock('http://localhost')

        const clientId = jwt.sign({
            jwks: {
                keys: [
                    {
                        kty: "RS384",
                        kid: "123",
                        n: "abc",
                        e: "AQAB",
                        key_ops: ["verify"]
                    }
                ]
            }
        }, JWT_SECRET, { algorithm: "HS256", keyid: "123" });
        
        const clientAssertion = jwt.sign({
            sub: clientId,
            iss: clientId,
            aud: `${baseUrl}/token`,
            exp: Math.floor(Date.now() / 1000) + 300
        }, JWT_SECRET, { algorithm: "HS256", keyid: "123" });

        const response = await request(baseUrl)
            .post("/token")
            .set("Content-Type", "application/x-www-form-urlencoded")
            .send({
                grant_type: "client_credentials",
                client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                client_assertion: clientAssertion,
                scope: "invalid-scope"
            });

        // console.log(response.body);
        // expect(response.status).to.equal(400);
        // expect(response.body).to.have.property("error", "invalid_scope");
        // expect(response.body).to.have.property("error_description");
    });

    // it("should return an error for expired client_assertion", async () => {
    //     const app = createApp();
    //     const clientAssertion = jwt.sign({
    //         sub: "client-id",
    //         iss: "client-id",
    //         aud: "http://localhost/token",
    //         // exp: Math.floor(Date.now() / 1000) - 300 // Expired token
    //     }, JWT_SECRET, { algorithm: "HS256", keyid: "123", expiresIn: 0 });

    //     const response = await request(app)
    //         .post("/token")
    //         .set("Content-Type", "application/x-www-form-urlencoded")
    //         .send({
    //             grant_type: "client_credentials",
    //             client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    //             client_assertion: clientAssertion,
    //             scope: "read write"
    //         });

    //     expect(response.status).to.equal(400);
    //     expect(response.body).to.have.property("error", "invalid_request");
    //     expect(response.body).to.have.property("error_description", "jwt expired");
    // });
});
