/*
 * Copyright 2016 Scott Bender <scott@scottbender.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Base class for expected, user-facing failures. Routes translate these into
// a 403 with the message in the body; anything else is a 500.
export class PluginError extends Error {
  constructor(message) {
    super(message);
    this.name = "PluginError";
  }
}

export class ValidationError extends PluginError {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}
