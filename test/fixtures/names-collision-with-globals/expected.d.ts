interface LocalDate {}
interface LocalPromise {}
export interface Int {
  localD: LocalDate;
  globalD: Date;
  localP: LocalPromise;
  globalP: Promise<number>;
}
