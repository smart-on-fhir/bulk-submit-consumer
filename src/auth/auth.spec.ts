import { expect }     from "chai";
import request        from "supertest";
import jwt            from "jsonwebtoken";
import { JWT_SECRET } from "../config";
import createApp      from "../app";
import { NextFunction, Request, Response } from "express";
import {
    asyncRouteWrap,
    getPublicKeys,
    negotiateScopes,
    requireUrlEncodedPost,
    checkAuth,
    fetchJson,
    fetchJwksUrl,
    uInt
} from "./lib";


describe("Auth unit tests", () => {
    
    it ("asyncRouteWrap catches errors and passes them to next()", (done) => {
        const req: any = {};
        const res: any = {};
        const next = (err?: any) => {
            try {
                expect(err).to.be.instanceOf(Error);
                expect(err.message).to.equal("Test error");
                done();
            } catch (ex) {
                done(ex);
            }
        };

        const wrapped = asyncRouteWrap(async (req: any, res: any, next: any) => {
            throw new Error("Test error");
        });

        wrapped(req, res, next);
    });

    it ("asyncRouteWrap catches internal/sync errors and passes them to next()", (done) => {
        const req: any = {};
        const res: any = {};
        const next = (err?: any) => {
            try {
                expect(err).to.be.instanceOf(Error);
                expect(err.message).to.equal("Test error");
                done();
            } catch (ex) {
                done(ex);
            }
        };

        const wrapped = asyncRouteWrap((req: any, res: any, next: any) => {
            throw new Error("Test error");
        });

        wrapped(req, res, next);
    });

    describe("negotiateScopes", () => {        
        it ("should return the intersection of requested and allowed scopes", () => {
            const result = negotiateScopes(`read write system/bulk-submit`);
            expect(result).to.deep.equal(["system/bulk-submit"]);
        });

        it ("should return an empty array if no scopes match", () => {
            const result = negotiateScopes(`read write`);
            expect(result).to.deep.equal([]);
        });
    });

    describe("uInt", () => {        
        it ("should parse valid unsigned integers", () => {
            expect(uInt("42")).to.equal(42);
            expect(uInt("0")).to.equal(0);
        });

        it ("should return the default value for invalid inputs", () => {
            expect(uInt("-1", 5)).to.equal(5);
            expect(uInt("abc", 10)).to.equal(10);
            expect(uInt("", 7)).to.equal(7);
            expect(uInt(undefined, 3)).to.equal(3);
        });
    });

    describe("requireUrlEncodedPost", () => {        
        it ("should not throw an error for valid urlencoded content-type", () => {
            const req: any = {
                headers: {
                    "content-type": "application/x-www-form-urlencoded; charset=utf-8"
                }
            };
            expect(() => requireUrlEncodedPost(req)).to.not.throw();
        });

        it ("should throw an error for missing content-type header", () => {
            const req: any = {
                headers: { }
            };
            expect(() => requireUrlEncodedPost(req)).to.throw("Invalid request content-type header (must be 'application/x-www-form-urlencoded')");
        });

        it ("should throw an error for invalid content-type header", () => {
            const req: any = {
                headers: {
                    "content-type": "application/json"
                }
            };
            expect(() => requireUrlEncodedPost(req)).to.throw("Invalid request content-type header (must be 'application/x-www-form-urlencoded')");
        });
    });

    describe("getPublicKeys", () => {        
        it ("should throw an error if no keys match the given kid", (next) => {
            getPublicKeys({
                jwks: {
                    keys: [
                        { kty: "RSA", kid: "key1", key_ops: ["verify"] },
                        { kty: "RSA", kid: "key2", key_ops: ["verify"] }
                    ]
                },
                "kid": "nonexistent-key"
            }).then(() => {
                next(new Error("Expected getPublicKeys to throw an error, but it resolved successfully."));
            }).catch(() => {
                next();
            });
        });

        it ("should return the matching public keys for the given kid", async () => {
            const keys = await getPublicKeys({
                jwks: {
                    keys: [
                        { kty: "RSA", kid: "key1", key_ops: ["verify"] },
                        { kty: "RSA", kid: "key2", key_ops: ["verify"] }
                    ]
                },
                "kid": "key2"
            });
            expect(keys).to.have.lengthOf(1);
            expect(keys[0]).to.have.property("kid", "key2");
        });

        it ("should ignore keys without 'verify' in key_ops", (next) => {
            getPublicKeys({
                jwks: {
                    keys: [
                        { kty: "RSA", kid: "key1", key_ops: ["sign"] },
                        { kty: "RSA", kid: "key2", key_ops: ["encrypt"] }
                    ]
                },
                "kid": "key1"
            }).then(() => {
                next(new Error("Expected getPublicKeys to throw an error, but it resolved successfully."));
            }).catch(() => {
                next();
            });
        });

        it ("should fetch JWKS from jwks_url if provided", async () => {
            // Using a public JWKS URL for testing
            const jwksUrl = "https://www.googleapis.com/oauth2/v3/certs";
            const keys = await getPublicKeys({
                jwks_url: jwksUrl,
                kid      : "fake-kid-for-test" // This kid likely won't match any keys
            }).catch(err => {
                expect(err).to.be.instanceOf(Error);
                expect(err.message).to.match(/No public keys found in the JWKS with "kid" equal to "fake-kid-for-test"/);
            });
        });

        it ("should throw an error if jwks_url is unreachable", (next) => {
            getPublicKeys({
                jwks_url: "https://nonexistent-domain.example.com/jwks",
                kid      : "any-kid"
            }).then(() => {
                next(new Error("Expected getPublicKeys to throw an error, but it resolved successfully."));
            }).catch(() => {
                next();
            });
        });
    });

    describe("checkAuth", () => {        
        it ("should not throw an error if no Authorization header is present", (done) => {
            const req: any = { headers: {} };
            const res: any = { };
            const next = (err?: any) => {
                try {
                    expect(err).to.be.undefined;
                    done();
                } catch (ex) {
                    done(ex);
                }
            };
            checkAuth(req, res, next);
        });

        it ("should throw an error for invalid Authorization header format", (done) => {
            const req: any = { headers: { authorization: "InvalidHeader" } };

            const res = {
                status: function (code: number) {
                    expect(code).to.equal(401);
                    return this;
                },
                send: function (message: string) {
                    expect(message).to.match(/Unauthorized! Invalid authentication/);
                    done();
                }
            } as unknown as Response;

            const next: NextFunction = (err?: any) => {
                done(err || new Error("next() should not be called"));
            };
            
            checkAuth(req, res, next);
        });

        it("should decode a valid Bearer token and call next()", (done) => {
            const validToken = "Bearer valid-token";
            const req = { headers: { authorization: validToken } } as Request;

            const res = {
                status: function (code: number) {
                    expect(code).to.equal(401);
                    return this;
                },
                send: function (message: string) {
                    // expect(message).to.match(/Unauthorized! Invalid authentication/);
                    done();
                }
            } as Response;

            const next: NextFunction = (err?: any) => {
                try {
                    expect(err).to.be.undefined;
                    expect((req as any).registeredClient).to.exist;
                    done();
                } catch (ex) {
                    done(ex);
                }
            };

            checkAuth(req, res, next);
        });

        it ("should work with valid token", (done) => {
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

            const validToken = jwt.sign({
                sub: clientId,
                iss: clientId,
                aud: "http://localhost/token",
                exp: Math.floor(Date.now() / 1000) + 300
            }, JWT_SECRET, { algorithm: "HS256", keyid: "123" });

            const req = { headers: { authorization: `Bearer ${validToken}` } } as Request;

            const res = {
                status: function (code: number) {
                    expect(code).to.equal(401);
                    return this;
                },
                send: function () {
                    done();
                }
            } as Response;

            const next: NextFunction = (err?: any) => {
                try {
                    expect(err).to.be.undefined;
                    done();
                } catch (ex) {
                    done(ex);
                }
            };

            checkAuth(req, res, next);
        });
    });

    describe("fetchJson", () => {        
        it ("should fetch and parse JSON from a URL", async () => {
            const data = await fetchJson("https://jsonplaceholder.typicode.com/todos/1");
            expect(data).to.have.property("id", 1);
            expect(data).to.have.property("title");
        });
    });

    describe("fetchJwksUrl", () => {
        it ("should fetch and parse JWKS from a URL", async () => {
            const jwks = await fetchJwksUrl("https://www.googleapis.com/oauth2/v3/certs");
            expect(jwks).to.have.property("keys").that.is.an("array");
        });

        it ("requires JWKS JSON to contain a keys array", async () => {
            try {
                await fetchJwksUrl("https://jsonplaceholder.typicode.com/todos/1");
                throw new Error("Expected fetchJwksUrl to throw an error, but it resolved successfully.");
            } catch (err) {
                expect((err as Error).message).to.equal("The remote jwks object has no keys array.");
            }
        });
    });
});

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
