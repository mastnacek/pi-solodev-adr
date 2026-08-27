/**
 * Types and interfaces for pi-solo-radar ADR Ledger
 */

export type ADRStatus = "active" | "superseded" | "deprecated";

export interface ADRRecord {
 id: string;
 title: string;
 date: string;
 context: string;
 decision: string;
 consequences: string;
 status: ADRStatus;
 file: string;
 rawContent?: string;
}

export interface ADRDraft {
 title: string;
 context: string;
 decision: string;
 consequences: string;
 date?: string;
 status?: ADRStatus;
}

export interface ADRIndexEntry {
 id: string;
 title: string;
 date: string;
 file: string;
 constraint: string;
 status: ADRStatus;
}

export interface ADRIndex {
 version: number;
 lastUpdated: string;
 records: ADRIndexEntry[];
}

export interface DetectionResult {
 detected: boolean;
 reason?: string;
 draft?: ADRDraft;
 matchedKeywords?: string[];
}

export interface SearchMatch extends ADRIndexEntry {
 score: number;
 snippet?: string;
}
