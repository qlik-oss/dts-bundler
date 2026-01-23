// @ts-expect-error - test case for external lib types
import { InterfaceWithFields } from "fake-package";
import { FakePackageType } from "./module-with-import-type";

export type TestType = InterfaceWithFields | FakePackageType;
