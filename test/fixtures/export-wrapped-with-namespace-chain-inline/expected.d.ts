import * as Ns from "fake-package";

type A = string;

declare namespace Ns1 {
}
declare namespace FirstNamespaceName {
  export { A, Ns, Ns1 };
}
declare namespace TopNamespaceName {
  export { FirstNamespaceName };
}

export { TopNamespaceName };
