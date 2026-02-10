interface MyInterface {}
export type MyType = {
  field: MyInterface;
  numberField: number;
  textField: string;
};
export type MySecondType = {
  field: MyType;
};
export type Output = {
  field: MySecondType;
  numberField: number;
  textField: string;
};
