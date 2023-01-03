export class Lock {
	public max;
	private readonly queue: (() => void)[] = [];
	private locked = 0;

	constructor(max: number) {
		this.max = max;
	}

	public async lock() {
		return new Promise<void>((resolve) => {
			if (this.locked < this.max) {
				this.locked++;
				resolve();
			} else {
				this.queue.push(resolve);
			}
		});
	}

	public unlock() {
		if (this.queue.length > 0) {
			this.queue.shift()?.();
		} else {
			this.locked--;
		}
	}
}
