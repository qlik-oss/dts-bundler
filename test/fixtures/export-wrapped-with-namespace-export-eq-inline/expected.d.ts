interface LibInterface {
  field: number;
}
export declare const myLib: LibInterface;

declare namespace myLib {
}
declare namespace newName {
}

export { myLib, newName };
