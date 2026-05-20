export class PlainClass {
  value: string;

  constructor(value: string = "") {
    this.value = value;
  }

  get current(): string {
    return this.value;
  }

  set current(value: string) {
    this.value = value;
  }

  append(suffix: string): string {
    this.value += suffix;
    return this.value;
  }
}
