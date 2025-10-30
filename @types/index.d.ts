interface ExportManifest {

    /**
     * indicates the server's time when the query is run. The response
     * SHOULD NOT include any resources modified after this instant,
     * and SHALL include any matching resources modified up to and
     * including this instant.
     * Note: To properly meet these constraints, a FHIR Server might need
     * to wait for any pending transactions to resolve in its database
     * before starting the export process.
     */
    transactionTime: string // FHIR instant

    /**
     * the full URL of the original bulk data kick-off request
     */
    request: string

    /**
     * indicates whether downloading the generated files requires a
     * bearer access token.
     * Value SHALL be true if both the file server and the FHIR API server
     * control access using OAuth 2.0 bearer tokens. Value MAY be false for
     * file servers that use access-control schemes other than OAuth 2.0,
     * such as downloads from Amazon S3 bucket URLs or verifiable file
     * servers within an organization's firewall.
     */
    requiresAccessToken: boolean
    
    /**
     * an array of file items with one entry for each generated file.
     * If no resources are returned from the kick-off request, the server
     * SHOULD return an empty array.
     */
    output: ExportManifestFile[]

    /**
     * array of error file items following the same structure as the output
     * array.
     * Errors that occurred during the export should only be included here
     * (not in output). If no errors occurred, the server SHOULD return an
     * empty array. Only the OperationOutcome resource type is currently
     * supported, so a server SHALL generate files in the same format as
     * bulk data output files that contain OperationOutcome resources.
     */
    error: ExportManifestFile<"OperationOutcome">[]

    /**
     * An array of deleted file items following the same structure as the
     * output array.
     * 
     * When a `_since` timestamp is supplied in the export request, this
     * array SHALL be populated with output files containing FHIR
     * Transaction Bundles that indicate which FHIR resources would have
     * been returned, but have been deleted subsequent to that date. If no
     * resources have been deleted or the _since parameter was not supplied,
     * the server MAY omit this key or MAY return an empty array.
     * 
     * Each line in the output file SHALL contain a FHIR Bundle with a type
     * of transaction which SHALL contain one or more entry items that
     * reflect a deleted resource. In each entry, the request.url and
     * request.method elements SHALL be populated. The request.method
     * element SHALL be set to DELETE.
     * 
     * Example deleted resource bundle (represents one line in output file):
     * @example 
     * ```json
     * {
     *     "resourceType": "Bundle",
     *     "id": "bundle-transaction",
     *     "meta": { "lastUpdated": "2020-04-27T02:56:00Z" },
     *     "type": "transaction",
     *     "entry":[{
     *         "request": { "method": "DELETE", "url": "Patient/123" }
     *         ...
     *     }]
     * }
     * ```
     */
    deleted?: ExportManifestFile<"Bundle">[]

    /**
     * To support extensions, this implementation guide reserves the name
     * extension and will never define a field with that name, allowing
     * server implementations to use it to provide custom behavior and
     * information. For example, a server may choose to provide a custom
     * extension that contains a decryption key for encrypted ndjson files.
     * The value of an extension element SHALL be a pre-coordinated JSON
     * object.
     */
    extension?: Record<string, any>

    /**
     * When provided, a server with support for the parameter SHALL organize
     * the resources in output files by instances of the specified resource
     * type, including a header for each resource of the type specified in
     * the parameter, followed by the resource and resources in the output
     * that contain references to that resource. When omitted, servers SHALL
     * organize each output file with resources of only single type.
     * 
     * A server unable to structure output by the requested organizeOutputBy
     * resource SHOULD return an error and FHIR OperationOutcome resource.
     * When a Prefer: handling=lenient header is included in the request,
     * the server MAY process the request instead of returning an error.
     */
    outputOrganizedBy?: string

    /**
     * Next link in case of paginated response
     */
    link?: [{ relation: "next"; url: string }]
}

interface ExportManifestFile<Type = string> {
    
    /**
     * the FHIR resource type that is contained in the file.
     * Each file SHALL contain resources of only one type, but a server MAY
     * create more than one file for each resource type returned. The number
     * of resources contained in a file MAY vary between servers. If no data
     * are found for a resource, the server SHOULD NOT return an output item
     * for that resource in the response. These rules apply only to top-level
     * resources within the response; as always in FHIR, any resource MAY
     * have a "contained" array that includes referenced resources of other
     * types.
     */
    type?: Type

    /**
     * the path to the file. The format of the file SHOULD reflect that
     * requested in the _outputFormat parameter of the initial kick-off
     * request.
     */
    url: string 

    /**
     * the number of resources in the file, represented as a JSON number.
     */
    count?: number

    extension: {
        manifestUrl: string;
        countSeverity: {
            success: number;
            error: number;
        }
        [key: string]: any;
    }
}

interface RequestResult {
    res     : Response | null
    request : RequestDescriptor | null,
    response: ResponseDescriptor | null
    error   : string | null
}

interface RequestDescriptor {
    method  : string,
    url     : string,
    headers : Record<string, string>,
    body    : any
}

interface ResponseDescriptor {
    headers   : Record<string, string>,
    body      : string | any | AsyncGenerator<any>, // text | json | ndjson | null
    status    : number,
    statusText: string,
}

/**
 * Context provided in CustomError instances.
 */
interface CustomErrorContext {

    // Common HTTP error context
    request?: RequestDescriptor  | null
    response?: ResponseDescriptor | null

    // Download-specific context
    filePath?: string;
    
    // NDJSON processing context
    lineNumber?: number;

    // FHIR resource context
    resource?: any;

    // FHIR issue type (see https://hl7.org/fhir/valueset-issue-type.html)
    issueType?: string;

}
