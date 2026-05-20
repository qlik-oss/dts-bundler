export class Example {
  public foo(): string {
    return "foo";
  }
  protected bar(): number {
    return 42;
  }
  private baz(): boolean {
    return true;
  }
  public value: number = 1;
  protected label: string = "label";
  private secret: symbol = Symbol("secret");
}
