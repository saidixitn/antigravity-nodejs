/**
 * googlesheet.js - Simple & Resilient Google Sheets Client
 * ========================================================
 * High-performance wrapper around Google Sheets API with rate-limit retries.
 */

import { getGoogleSheets } from "./auth.js";
import pRetry from "p-retry";

export class GoogleSheetManager {
  /**
   * Reads values from a spreadsheet range
   */
  async read(spreadsheetId, range) {
    const sheets = await getGoogleSheets();
    return pRetry(
      async () => {
        const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
        return res.data.values || [];
      },
      { retries: 3 }
    );
  }

  /**
   * Clears a range
   */
  async clear(spreadsheetId, range) {
    const sheets = await getGoogleSheets();
    return pRetry(
      async () => {
        await sheets.spreadsheets.values.clear({ spreadsheetId, range });
      },
      { retries: 3 }
    );
  }

  /**
   * Writes values to a range
   */
  async write(spreadsheetId, range, values, valueInputOption = "USER_ENTERED") {
    const sheets = await getGoogleSheets();
    return pRetry(
      async () => {
        const res = await sheets.spreadsheets.values.update({
          spreadsheetId,
          range,
          valueInputOption,
          requestBody: { values },
        });
        return res.data;
      },
      { retries: 3 }
    );
  }

  /**
   * Appends values to a sheet
   */
  async append(spreadsheetId, range, values, valueInputOption = "USER_ENTERED") {
    const sheets = await getGoogleSheets();
    return pRetry(
      async () => {
        const res = await sheets.spreadsheets.values.append({
          spreadsheetId,
          range,
          valueInputOption,
          requestBody: { values },
        });
        return res.data;
      },
      { retries: 3 }
    );
  }

  /**
   * Applies header formatting (dark background, bold white text)
   */
  async formatHeader(spreadsheetId, sheetId, colsCount = 10) {
    const sheets = await getGoogleSheets();
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 6,
                  endRowIndex: 7,
                  startColumnIndex: 0,
                  endColumnIndex: colsCount,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.12, green: 0.2, blue: 0.32 },
                    textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                  },
                },
                fields: "userEnteredFormat",
              },
            },
          ],
        },
      });
    } catch (e) {
      // formatting is cosmetic; ignore if sheetId differs
    }
  }
}

export const googlesheet = new GoogleSheetManager();
export default googlesheet;
