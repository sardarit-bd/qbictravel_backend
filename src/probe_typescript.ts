import 'dotenv/config';
import type { Request, Response, NextFunction } from 'express';

// Simulate the exact requirePermission logic
function testRequirePermission(req: Request, next: NextFunction) {
  console.log('req.user:', req.user ? `role="${req.user.role}" (type: ${typeof req.user.role})` : 'not set');
  console.log('req.user.role === "admin":', req.user?.role === 'admin');
  console.log('req.user.role == "admin":', req.user?.role == 'admin');
  console.log('String(req.user.role):', req.user ? String(req.user.role) : 'N/A');
  console.log('req.user.role === String("admin"):', req.user?.role === String('admin'));
  
  if (!req.user) {
    return next(new Error('Unauthorized'));
  }

  if (req.user.role === "admin") {
    console.log('ADMIN BYPASS TRIGGERED');
    return next();
  }

  if (req.user.role !== "staff") {
    console.log('403: role is', req.user.role);
    return next(new Error('Forbidden'));
  }
}

// Create a mock request with role as a string literal type
const mockReq = {
  user: {
    id: 'test-id',
    role: 'admin' as const,
    name: 'Test',
    email: 'test@test.com'
  }
} as any;

console.log('=== Test 1: role as "admin" ===');
testRequirePermission(mockReq, (err?: any) => {
  if (err) {
    console.log('Error:', err.message);
  } else {
    console.log('Success - next() called without error');
  }
});

// Test with role as a potentially different string type
const mockReq2 = {
  user: {
    id: 'test-id',
    role: 'admin',  // Not as const
    name: 'Test',
    email: 'test@test.com'
  }
} as any;

console.log('\n=== Test 2: role as "admin" (not const) ===');
testRequirePermission(mockReq2, (err?: any) => {
  if (err) {
    console.log('Error:', err.message);
  } else {
    console.log('Success - next() called without error');
  }
});
