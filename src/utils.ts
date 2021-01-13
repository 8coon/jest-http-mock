import * as http from 'http';

export class Resolvable<T = any> {
	public readonly promise: Promise<T>;
	public settled = false;
	private _resolve?: (data: T) => void;
	private _reject?: (error: any) => void;

	constructor() {
		this.promise = new Promise<T>((resolve, reject) => {
			this._resolve = resolve;
			this._reject = reject;
		});
	}

	public resolve = (data: T) => {
		if (this._resolve) {
			this.settled = true;
			this._resolve(data);
		}
	};

	public reject = (error?: any) => {
		if (this._reject) {
			this.settled = true;
			this._reject(error);
		}
	};
}

export function bodyReader(request: http.IncomingMessage): () => Promise<Buffer> {
	let promise: Promise<Buffer>;

	return () => {
		if (!promise) {
			promise = new Promise<Buffer>((resolve, reject) => {
				const body: Buffer[] = [];
				let rejected = false;

				request.on('data', (chunk) => {
					body.push(chunk);
				});

				request.on('error', (error) => {
					rejected = true;
					reject(error);
				});

				request.on('end', () => {
					if (rejected) {
						return;
					}

					resolve(Buffer.concat(body));
				});
			});
		}

		return promise;
	}
}
