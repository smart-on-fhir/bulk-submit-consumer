import { Request, Response } from "express";
import { join, extname } from "path";

const mimeTypes: Record<string, string> = {
    ".ndjson": "application/fhir+ndjson",
    ".json": "application/json",
    ".txt": "text/plain"
    // Add more as needed
};

export default function bulkStatusFileHandler(req: Request, res: Response): void {
    const { jobId, fileName } = req.params;
    const pathToFile = join(__dirname, `../jobs/${jobId}/files/${fileName}`);
    const ext = extname(fileName).toLowerCase();
    const contentType = mimeTypes[ext] || "application/octet-stream";

    res.sendFile(pathToFile, {
        headers: {
            "Content-Type": contentType,
            "Content-Disposition": `inline; filename="${fileName}"`
        }
    }, (err) => {
        if (err) {
            res.status(404).json({ message: "File not found" });
        }
    });
}