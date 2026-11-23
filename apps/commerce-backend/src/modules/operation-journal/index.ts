import { Module } from "@medusajs/framework/utils";
import OperationJournalService from "./service";

export const operationJournalModule = "rifareOperationJournal";

export default Module(operationJournalModule, { service: OperationJournalService });
