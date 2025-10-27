export default class StatusManifest {
    
    /**
     * Indicates the server's time when the query is run. The response SHOULD
     * NOT include any resources modified after this instant, and SHALL include
     * any matching resources modified up to and including this instant.
     */
    readonly transactionTime: ExportManifest["transactionTime"];
    
    request: ExportManifest["request"];

    requiresAccessToken: ExportManifest["requiresAccessToken"];
    
    output: ExportManifest["output"];

    error: ExportManifest["error"];

    constructor(kickoffUrl: string) {
        this.transactionTime = new Date().toISOString();
        this.request = kickoffUrl;
        this.requiresAccessToken = false;
        this.output = [];
        this.error = [];
    }

    toJSON(): ExportManifest {
        return {
            transactionTime: this.transactionTime,
            request: this.request,
            requiresAccessToken: this.requiresAccessToken,
            output: this.output,
            error: this.error
        };
    }

    addOutputFile(url: string, count: number, type?: string) {
        this.output.push({
            type: type || "Resource",
            url,
            count
        });
    }
    
    addErrorFile(url: string, count: number) {
        this.error.push({
            type: "OperationOutcome",
            url,
            count
        });
    }
}
