import { describe, expect, test } from 'bun:test';
import { AbpError, isCourtClosedError, isRateLimitError } from './errors.js';

const abp = (message: string, details: string | null = null): AbpError =>
  new AbpError('/CreateOrEdit', message, details, false, 400, 200);

describe('isRateLimitError', () => {
  test('matches English rate-limit message', () => {
    expect(isRateLimitError(abp('Booking too frequent', 'You are booking too frequently.'))).toBe(true);
  });

  test('matches Thai rate-limit message', () => {
    expect(isRateLimitError(abp('จองถี่เกินไป', 'คุณทำรายการจองถี่เกินไป กรุณารอสักครู่แล้วลองใหม่'))).toBe(true);
  });

  test('rejects other AbpErrors and plain errors', () => {
    expect(isRateLimitError(abp('ไม่สามารถจองได้!'))).toBe(false);
    expect(isRateLimitError(new Error('Booking too frequent'))).toBe(false);
  });
});

describe('isCourtClosedError', () => {
  test('matches court-closed message in details', () => {
    expect(isCourtClosedError(abp('ไม่สามารถจองได้!', 'สนาม/คอร์ตปิดทำการในวัน/เวลาที่คุณเลือก'))).toBe(true);
  });

  test('rejects rate-limit errors', () => {
    expect(isCourtClosedError(abp('จองถี่เกินไป'))).toBe(false);
  });
});

describe('AbpError message', () => {
  test('includes code and http status when present', () => {
    expect(abp('msg', 'detail').message).toBe('/CreateOrEdit: msg (detail) [code=400 http=200]');
  });

  test('omits code part when absent', () => {
    expect(new AbpError('/x', 'msg', null, false).message).toBe('/x: msg');
  });
});
