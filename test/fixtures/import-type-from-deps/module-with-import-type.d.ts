// yes, these tabs are here on purpose
// @ts-expect-error - test case for external lib types
import {	type				InterfaceWithFields } from 'fake-package';

export declare type FakePackageType = InterfaceWithFields | string;
