import { router, publicProcedure } from './trpc';
import { z } from 'zod';

import * as tasksCommand from '../modules/tasks/command';
import * as interestCommand from '../modules/interests/command';
import * as domainsRepo from '../modules/domains/repository';
import * as projectsCommand from '../modules/projects/command';
import * as notesCommand from '../modules/notes/command';
import * as financeCommand from '../modules/finance/command';
import * as remindersCommand from '../modules/reminders/command';
import * as flowCommand from '../modules/flow/command';
import { dailyCard, pressureBackpack } from '../modules/insights/ruleEngine';

import {
  createTaskSchema,
  completeTaskSchema,
  uncompleteTaskSchema,
  updateTaskSchema,
  deleteTaskSchema,
  setQuadrantSchema,
  scheduleTaskSchema,
  setMitSchema,
  createProjectSchema,
  ingestNoteSchema,
  updateNoteSchema,
  deleteNoteSchema,
  createDebtSchema,
  updateDebtSchema,
  closeDebtSchema,
  reopenDebtSchema,
  deleteDebtSchema,
  recordIncomeSchema,
  updateIncomeSchema,
  deleteIncomeSchema,
  recordTransactionSchema,
  updateTransactionSchema,
  deleteTransactionSchema,
  recordAssetSchema,
  updateAssetSchema,
  deleteAssetSchema,
  createReminderSchema,
  completeReminderSchema,
  rewindReminderSchema,
  snoozeReminderSchema,
  updateReminderSchema,
  deleteReminderSchema,
  recordFocusSessionSchema,
  flowSummaryQuerySchema,
  captureInterestSchema,
  updateInterestSchema,
  setInterestStatusSchema,
  validateInterestSchema,
  convertInterestSchema,
  interestReviewQuerySchema,
} from '@dm-life/shared';

export const appRouter = router({
  tasks: {
    today: publicProcedure.query(() => tasksCommand.listToday()),
    all: publicProcedure.query(() => tasksCommand.listAll()),
    create: publicProcedure
      .input(createTaskSchema)
      .mutation(({ input }) => tasksCommand.createTask(input)),
    complete: publicProcedure
      .input(completeTaskSchema)
      .mutation(({ input }) => tasksCommand.completeTask(input)),
    uncomplete: publicProcedure
      .input(uncompleteTaskSchema)
      .mutation(({ input }) => tasksCommand.uncompleteTask(input)),
    setQuadrant: publicProcedure
      .input(setQuadrantSchema)
      .mutation(({ input }) => tasksCommand.setQuadrant(input)),
    schedule: publicProcedure
      .input(scheduleTaskSchema)
      .mutation(({ input }) => tasksCommand.scheduleTask(input)),
    setMit: publicProcedure
      .input(setMitSchema)
      .mutation(({ input }) => tasksCommand.setMit(input)),
    update: publicProcedure
      .input(updateTaskSchema)
      .mutation(({ input }) => tasksCommand.updateTask(input)),
    delete: publicProcedure
      .input(deleteTaskSchema)
      .mutation(({ input }) => tasksCommand.deleteTask(input)),
  },
  interests: {
    capture: publicProcedure
      .input(captureInterestSchema)
      .mutation(({ input }) => interestCommand.captureInterest(input)),
    list: publicProcedure
      .input(interestReviewQuerySchema.optional())
      .query(({ input }) => interestCommand.listInterests(input?.status ? { status: input.status } : undefined)),
    update: publicProcedure
      .input(updateInterestSchema)
      .mutation(({ input }) => interestCommand.updateInterest(input)),
    setStatus: publicProcedure
      .input(setInterestStatusSchema)
      .mutation(({ input }) => interestCommand.setStatus(input)),
    validate: publicProcedure
      .input(validateInterestSchema)
      .mutation(({ input }) => interestCommand.validateInterest(input)),
    convert: publicProcedure
      .input(convertInterestSchema)
      .mutation(({ input }) => interestCommand.convertInterest(input)),
    recordView: publicProcedure
      .input(z.object({ id: z.string().min(1) }))
      .mutation(({ input }) => interestCommand.recordView(input)),
    review: publicProcedure
      .input(interestReviewQuerySchema.optional())
      .query(({ input }) => interestCommand.review(input ?? {})),
  },
  domains: {
    list: publicProcedure.query(() => domainsRepo.list()),
    balanceWheel: publicProcedure
      .input(z.object({ week: z.string() }))
      .query(({ input }) => domainsRepo.balanceWheel(input.week)),
  },
  projects: {
    list: publicProcedure.query(() => projectsCommand.listProjects()),
    create: publicProcedure
      .input(createProjectSchema)
      .mutation(({ input }) => projectsCommand.createProject(input)),
  },
  notes: {
    ingest: publicProcedure
      .input(ingestNoteSchema)
      .mutation(({ input }) => notesCommand.ingestNote(input)),
    update: publicProcedure
      .input(updateNoteSchema)
      .mutation(({ input }) => notesCommand.updateNote(input)),
    delete: publicProcedure
      .input(deleteNoteSchema)
      .mutation(({ input }) => notesCommand.deleteNote(input)),
    list: publicProcedure
      .input(z.object({ kind: z.enum(['idea', 'notebook']).optional() }).optional())
      .query(({ input }) => notesCommand.listNotes(input?.kind)),
  },
  insights: {
    dailyCard: publicProcedure.query(() => dailyCard()),
    pressure: publicProcedure.query(() => pressureBackpack()),
  },
  finance: {
    debts: {
      list: publicProcedure.query(() => financeCommand.listDebts()),
      create: publicProcedure
        .input(createDebtSchema)
        .mutation(({ input }) => financeCommand.createDebt(input)),
      update: publicProcedure
        .input(updateDebtSchema)
        .mutation(({ input }) => financeCommand.updateDebt(input)),
      close: publicProcedure
        .input(closeDebtSchema)
        .mutation(({ input }) => financeCommand.closeDebt(input)),
      reopen: publicProcedure
        .input(reopenDebtSchema)
        .mutation(({ input }) => financeCommand.reopenDebt(input)),
      delete: publicProcedure
        .input(deleteDebtSchema)
        .mutation(({ input }) => financeCommand.deleteDebt(input)),
    },
    incomes: {
      list: publicProcedure.query(() => financeCommand.listIncomes()),
      record: publicProcedure
        .input(recordIncomeSchema)
        .mutation(({ input }) => financeCommand.recordIncome(input)),
      update: publicProcedure
        .input(updateIncomeSchema)
        .mutation(({ input }) => financeCommand.updateIncome(input)),
      delete: publicProcedure
        .input(deleteIncomeSchema)
        .mutation(({ input }) => financeCommand.deleteIncome(input)),
    },
    transactions: {
      list: publicProcedure.query(() => financeCommand.listTransactions()),
      record: publicProcedure
        .input(recordTransactionSchema)
        .mutation(({ input }) => financeCommand.recordTransaction(input)),
      update: publicProcedure
        .input(updateTransactionSchema)
        .mutation(({ input }) => financeCommand.updateTransaction(input)),
      delete: publicProcedure
        .input(deleteTransactionSchema)
        .mutation(({ input }) => financeCommand.deleteTransaction(input)),
    },
    assets: {
      list: publicProcedure.query(() => financeCommand.listAssets()),
      record: publicProcedure
        .input(recordAssetSchema)
        .mutation(({ input }) => financeCommand.recordAsset(input)),
      update: publicProcedure
        .input(updateAssetSchema)
        .mutation(({ input }) => financeCommand.updateAsset(input)),
      delete: publicProcedure
        .input(deleteAssetSchema)
        .mutation(({ input }) => financeCommand.deleteAsset(input)),
    },
    summary: publicProcedure.query(() => financeCommand.summary()),
    debtSchedule: publicProcedure
      .input(z.object({ id: z.string().min(1) }))
      .query(({ input }) => financeCommand.debtSchedule(input.id)),
    debtProgressSummary: publicProcedure.query(() => financeCommand.debtProgressSummary()),
    debtPayoffAdvice: publicProcedure
      .input(z.object({ mode: z.enum(['avalanche', 'snowball']) }))
      .query(({ input }) => financeCommand.debtPayoffAdvice(input.mode)),
    trend: publicProcedure
      .input(z.object({ months: z.number().int().min(1).max(24).optional() }))
      .query(({ input }) => financeCommand.monthlyTrend(input.months ?? 6)),
    autoRefresh: publicProcedure.mutation(() => financeCommand.autoRefresh()),
  },
  reminders: {
    list: publicProcedure.query(() => remindersCommand.listClocks()),
    upcoming: publicProcedure
      .input(z.object({ horizon: z.string().optional() }).optional())
      .query(({ input }) => {
        const horizon = input?.horizon ?? new Date(Date.now() + 30 * 86400000).toISOString();
        return remindersCommand.listUpcoming(horizon);
      }),
    create: publicProcedure
      .input(createReminderSchema)
      .mutation(({ input }) => remindersCommand.createReminder(input)),
    complete: publicProcedure
      .input(completeReminderSchema)
      .mutation(({ input }) => remindersCommand.completeReminder(input)),
    rewind: publicProcedure
      .input(rewindReminderSchema)
      .mutation(({ input }) => remindersCommand.rewindReminder(input)),
    snooze: publicProcedure
      .input(snoozeReminderSchema)
      .mutation(({ input }) => remindersCommand.snoozeReminder(input)),
    update: publicProcedure
      .input(updateReminderSchema)
      .mutation(({ input }) => remindersCommand.updateReminder(input)),
    delete: publicProcedure
      .input(deleteReminderSchema)
      .mutation(({ input }) => remindersCommand.deleteReminder(input)),
    /** 调度器 tick：让到期钟响铃 / 逾期钟转背包 */
    tick: publicProcedure.mutation(() => remindersCommand.tickReminders()),
  },

  /** 心流仪表盘（认知资源管理） */
  flow: {
    record: publicProcedure
      .input(recordFocusSessionSchema)
      .mutation(({ input }) => flowCommand.recordSession(input)),
    list: publicProcedure.query(() => flowCommand.listSessions()),
    summary: publicProcedure
      .input(flowSummaryQuerySchema)
      .query(({ input }) => flowCommand.summarize(input)),
  },
});

export type AppRouter = typeof appRouter;
