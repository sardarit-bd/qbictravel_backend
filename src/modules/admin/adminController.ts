import { Request, Response, NextFunction } from "express";
import sendResponse from "../../shared/utils/response.js";
import * as adminService from "./adminService.js";
import type { ListUsersQuery } from "./adminTypes.js";

const query = (res: Response): ListUsersQuery => res.locals.query as ListUsersQuery;

export const listUsers = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await adminService.listUsers(query(res));
    sendResponse(res, 200, true, "Users retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const getUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await adminService.getUser(req.params.userId as string);
    sendResponse(res, 200, true, "User retrieved successfully", user);
  } catch (error) {
    next(error);
  }
};

export const updateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await adminService.updateUser(req.user!, req.params.userId as string, req.body);
    sendResponse(res, 200, true, "User updated successfully", user);
  } catch (error) {
    next(error);
  }
};

export const createAgent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const agent = await adminService.createAgent(req.body);
    sendResponse(res, 201, true, "Agent created successfully", agent);
  } catch (error) {
    next(error);
  }
};

export const listAgents = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await adminService.listAgents(query(res));
    sendResponse(res, 200, true, "Agents retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const getAgent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const agent = await adminService.getAgent(req.params.agentId as string);
    sendResponse(res, 200, true, "Agent retrieved successfully", agent);
  } catch (error) {
    next(error);
  }
};

export const updateAgent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const agent = await adminService.updateAgent(req.user!, req.params.agentId as string, req.body);
    sendResponse(res, 200, true, "Agent updated successfully", agent);
  } catch (error) {
    next(error);
  }
};

export const listStaff = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await adminService.listStaff(query(res));
    sendResponse(res, 200, true, "Staff retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const createStaff = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const staff = await adminService.createStaff(req.body);
    sendResponse(res, 201, true, "Staff account created successfully", staff);
  } catch (error) {
    next(error);
  }
};

export const updateStaff = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const staff = await adminService.updateStaff(req.user!, req.params.staffId as string, req.body);
    sendResponse(res, 200, true, "Staff account updated successfully", staff);
  } catch (error) {
    next(error);
  }
};