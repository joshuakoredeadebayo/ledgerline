import type { Frequency } from "@/lib/recurring";

export interface RecurringStarter {
  id: string;
  label: string;
  hint: string;
  name: string;
  description: string;
  frequency: Frequency;
  dayOfMonth: number;
}

/** Common regular entries, to start a template from instead of a blank page. The accounts and amounts are yours to choose. */
export const RECURRING_STARTERS: RecurringStarter[] = [
  { id: "rent", label: "Rent", hint: "Office or shop rent", name: "Office rent", description: "Monthly rent", frequency: "monthly", dayOfMonth: 1 },
  { id: "subscription", label: "Subscription", hint: "Software and services", name: "Software subscription", description: "Monthly subscription", frequency: "monthly", dayOfMonth: 1 },
  { id: "salaries", label: "Salaries", hint: "Monthly payroll", name: "Monthly salaries", description: "Salaries for the month", frequency: "monthly", dayOfMonth: 25 },
  { id: "loan", label: "Loan repayment", hint: "Instalments", name: "Loan repayment", description: "Monthly loan instalment", frequency: "monthly", dayOfMonth: 28 },
  { id: "insurance", label: "Insurance", hint: "Quarterly premium", name: "Insurance premium", description: "Quarterly insurance premium", frequency: "quarterly", dayOfMonth: 1 },
  { id: "depreciation", label: "Depreciation", hint: "Month-end charge", name: "Monthly depreciation", description: "Depreciation for the month", frequency: "monthly", dayOfMonth: 31 },
];
