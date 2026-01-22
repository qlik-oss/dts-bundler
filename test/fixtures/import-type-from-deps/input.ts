// @ts-expect-error - test case for external lib types
import { InterfaceWithFields } from "fake-package";
// @ts-expect-error - test case
import { FakePackageType } from "./module-with-import-type";

export type TestType = InterfaceWithFields | FakePackageType;
