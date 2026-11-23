import { Module } from "@medusajs/framework/utils";

// Keep journal rows private to the module. Future writes go through the
// ownership-checked service rather than generic entity CRUD.
class OperationJournalService {}

export default Module("rifareOperationJournal", { service: OperationJournalService });
