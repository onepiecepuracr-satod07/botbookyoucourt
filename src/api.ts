import {
  bookingCreationTimeBody,
  bookingDateBody,
  bookingDateQuery,
  formatIso,
  type IctDate,
} from './ict.js';
import { SPORT_STATION_TENNIS, SPORT_TYPE_TENNIS } from './config.js';

const BASE_URL = 'https://bookyourcourtapi.psm.tu.ac.th';

interface AbpEnvelope<T> {
  result: T;
  success: boolean;
  error: { code?: number; message: string; details?: string | null } | null;
  unAuthorizedRequest: boolean;
}

export class AbpError extends Error {
  constructor(
    readonly endpoint: string,
    readonly abpMessage: string,
    readonly details: string | null,
    readonly unAuthorizedRequest: boolean,
  ) {
    super(`${endpoint}: ${abpMessage}${details ? ` (${details})` : ''}`);
    this.name = 'AbpError';
  }
}

export interface CourtRow {
  courtId: number;
  courtName: string;
  bookingDate: string;
  [slot: `t${number}`]: number | null | undefined;
}

export interface BookingView {
  booking: {
    bookingCode: string;
    bookingDate: string;
    bookingTime: string;
    bookingStatus: string;
    courtId: number;
    id: number;
  };
  courtCourtName: string;
}

export class BookYourCourtClient {
  private accessToken: string | null = null;

  constructor(private readonly accountName: string) {}

  get account(): string {
    return this.accountName;
  }

  async authenticate(username: string, password: string): Promise<void> {
    const result = await this.request<{ accessToken: string }>(
      'POST',
      '/api/TokenAuth/Authenticate',
      {
        body: {
          userNameOrEmailAddress: username,
          password,
          rememberClient: false,
          singleSignIn: false,
          returnUrl: null,
          captchaResponse: null,
        },
        skipAuth: true,
      },
    );
    if (!result.accessToken) throw new Error(`authenticate(${this.accountName}): no accessToken in response`);
    this.accessToken = result.accessToken;
  }

  async listCourts(date: IctDate, today: 1 | 2): Promise<CourtRow[]> {
    const query = new URLSearchParams({
      sportTypeId: '0',
      sportStationId: String(SPORT_STATION_TENNIS),
      courtId: '0',
      bookingDate: bookingDateQuery(date),
      today: String(today),
    });
    return this.request<CourtRow[]>('GET', `/api/services/app/Bookings/GetListCourtForBooking?${query}`);
  }

  async createBooking(date: IctDate, todayDate: IctDate, hour: number, courtId: number): Promise<number> {
    const isSameDay = formatIso(date) === formatIso(todayDate);
    return this.request<number>('POST', '/api/services/app/Bookings/CreateOrEdit', {
      body: {
        today: isSameDay ? 1 : 2,
        bookingDate: bookingDateBody(date),
        bookingTime: `${String(hour).padStart(2, '0')}:00`,
        bookingCreationTime: bookingCreationTimeBody(todayDate),
        sportTypeId: SPORT_TYPE_TENNIS,
        sportStationId: SPORT_STATION_TENNIS,
        courtId,
      },
    });
  }

  async getBooking(id: number): Promise<BookingView> {
    return this.request<BookingView>('GET', `/api/services/app/Bookings/GetBookingForView?id=${id}`);
  }

  async cancelBooking(bookingCode: string): Promise<boolean> {
    return this.request<boolean>(
      'POST',
      `/api/services/app/Bookings/CancelBooking?bookingCode=${encodeURIComponent(bookingCode)}`,
    );
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: { body?: unknown; skipAuth?: boolean } = {},
  ): Promise<T> {
    if (!options.skipAuth && !this.accessToken) {
      throw new Error(`${this.accountName}: not authenticated`);
    }
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(options.skipAuth ? {} : { Authorization: `Bearer ${this.accessToken}` }),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = await response.text();
    let envelope: AbpEnvelope<T>;
    try {
      envelope = JSON.parse(text) as AbpEnvelope<T>;
    } catch {
      throw new Error(`${path}: HTTP ${response.status}, non-JSON body: ${text.slice(0, 200)}`);
    }
    if (!envelope.success) {
      throw new AbpError(
        path,
        envelope.error?.message ?? `HTTP ${response.status}`,
        envelope.error?.details ?? null,
        envelope.unAuthorizedRequest,
      );
    }
    return envelope.result;
  }
}
