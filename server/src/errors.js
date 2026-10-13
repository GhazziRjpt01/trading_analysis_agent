/** Expected failure with an HTTP status. The global handler turns it into JSON. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
