import type { IctDate } from './ict.js';
import type { BookingView, CourtRow } from './types.js';

export interface BookingGateway {
  readonly account: string;
  authenticate(username: string, password: string): Promise<void>;
  listCourts(date: IctDate, today: 1 | 2): Promise<CourtRow[]>;
  createBooking(date: IctDate, todayDate: IctDate, hour: number, courtId: number): Promise<number>;
  getBooking(id: number): Promise<BookingView>;
  cancelBooking(bookingCode: string): Promise<boolean>;
}

export interface Notifier {
  notify(message: string): Promise<void>;
}
