interface LibInterface {
  field: number;
}
export declare const myLib: LibInterface;

declare namespace newName {
}
declare namespace myLib {
}

export { newName, myLib };
