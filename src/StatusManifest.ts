import { OperationOutcome }             from "fhir/r4";
import { join }                         from "path";
import { randomUUID }                   from "crypto";
import { appendFile, mkdir, unlink, writeFile } from "fs/promises";
import CustomError                      from "./CustomError";
import { BASE_URL }                     from "./config";


/**
 * We  currently only have one manifest per submission.
 */
export default class StatusManifest {
    
    /**
     * Indicates the server's time when the query is run. The response SHOULD
     * NOT include any resources modified after this instant, and SHALL include
     * any matching resources modified up to and including this instant.
     */
    readonly transactionTime: ExportManifest["transactionTime"];

    readonly submissionId: string;

    /**
     * This will have one entry per manifestUrl.
     */
    private error: Record<string, {
        entry: ExportManifestFile<"OperationOutcome">;
        filePath: string;
    }>;

    constructor(submissionId: string) {
        this.transactionTime = new Date().toISOString();
        this.error = {};
        this.submissionId = submissionId;
    }

    toJSON(): ExportManifest {
        return {
            extension: {
                submissionId: this.submissionId
            },
            transactionTime: this.transactionTime,
            request: `${BASE_URL}/$bulk-submit-status`,
            requiresAccessToken: false,
            output: [],
            error: Object.values(this.error).map(e => e.entry),
        };
    }

    /**
     * For each manifest URL in the submission we need to create a separate
     * error entry and a corresponding ndjson file to hold OperationOutcome
     * resources.
     */
    private async addManifestUrl(manifestUrl: string) {
        const id       = randomUUID();
        const fileName = `${id}.ndjson`;
        const fileUrl  = `/jobs/${this.submissionId}/files/${fileName}`;
        const filePath = join(__dirname, `..${fileUrl}`);
        
        const entry: ExportManifestFile<"OperationOutcome"> = {
            type: "OperationOutcome",
            url : BASE_URL + fileUrl,
            extension: {
                manifestUrl,
                countSeverity: { success: 0, error: 0 }
            }
        };

        await mkdir(join(__dirname, `../jobs/${this.submissionId}/files/`), { recursive: true });
        await writeFile(filePath, '');

        this.error[manifestUrl] = { entry, filePath };

        return { entry, filePath };
    }

    async removeManifestUrl(manifestUrl: string) {
        if (this.error[manifestUrl]) {
            // If there is an error file for this manifest URL, delete it
            await unlink(this.error[manifestUrl].filePath);
            // Remove the entry from the error map
            delete this.error[manifestUrl];
        }
    }

    /**
     * In case of success we don't append any OperationOutcome resources. We
     * just increment the success count in the countSeverity extension. There is
     * no need save anything because the manifest lives in memory.
     */
    async addSuccess(manifestUrl: string) {
        let entry = this.error[manifestUrl]?.entry;
        if (!entry) {
            entry = (await this.addManifestUrl(manifestUrl)).entry;
        }
        entry.extension.countSeverity.success++;
    }

    /**
     * In case of error we need to create an OperationOutcome resource, append
     * it to the errors ndjson file, save the file, and increment the error
     * count in the countSeverity extension.
     */
    async addError(error: CustomError, manifestUrl: string) {

        // Create an OperationOutcome resource for this error
        const operationOutcome: OperationOutcome = {
            resourceType: "OperationOutcome",
            id: randomUUID(),
            issue: [{
                severity: "error",
                code: error.context.issueType || "processing",
                details: {
                    text: error.message
                }
            }]
        };

        // If we have a resource context, add the relatedArtifact extension
        if (error.context.resource) {
            operationOutcome.extension = [{
                url: "http://hl7.org/fhir/StructureDefinition/artifact-relatedArtifact",
                valueRelatedArtifact: {
                    // @ts-ignore
                    type: "comments-on",
                    resourceReference: `${error.context.resource?.resourceType}/${error.context.resource?.id}`
                }
            }];
        }

        // Get the entry and the file path for this manifest URL
        let node = this.error[manifestUrl] || await this.addManifestUrl(manifestUrl);

        // Ensure the directory exists before appending to the file
        await mkdir(join(node.filePath, '..'), { recursive: true });

        // Append the OperationOutcome resource to the ndjson file
        await appendFile(node.filePath, JSON.stringify(operationOutcome) + '\n');

        // Increment the error count in the countSeverity extension
        node.entry.extension!.countSeverity.error++;
    }
}
