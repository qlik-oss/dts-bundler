interface MyInterface {}

export type MyType = {
  field: MyInterface;
  numberField: number;
  textField: string;
};

export type MySecondType = {
  field: MyType;
};
