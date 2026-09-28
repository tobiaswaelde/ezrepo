import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Collect hand-maintained API sources, excluding generated clients and test specifications. */
export function apiSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : apiSourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.(?:spec|test)\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Visit named implementations and method contracts without treating inline callbacks as declarations. */
export function documentedDeclarations(source) {
  const declarations = [];
  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isMethodSignature(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      declarations.push({ anchor: node, callable: node });
    } else if (
      (ts.isVariableDeclaration(node) ||
        ts.isPropertyDeclaration(node) ||
        (ts.isPropertyAssignment(node) && ts.isVariableDeclaration(node.parent.parent))) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      declarations.push({
        anchor: ts.isVariableDeclaration(node) ? node.parent.parent : node,
        callable: node.initializer,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return declarations;
}

/** Give destructured parameters a stable positional name for their documentation tags. */
export function parameterName(parameter, index) {
  return ts.isIdentifier(parameter.name) ? parameter.name.text : `param${index}`;
}

/** Read plain text from both simple and link-containing TypeScript documentation comments. */
function commentText(comment) {
  return typeof comment === 'string' ? comment : (comment?.map((part) => part.text).join('') ?? '');
}

/** Detect explicit escaping throws; caught errors and nested callbacks require a semantic review instead. */
function hasEscapingThrow(callable) {
  let found = false;
  function visit(node) {
    if (node !== callable && ts.isFunctionLike(node)) return;
    if (ts.isThrowStatement(node)) {
      for (let parent = node.parent; parent && parent !== callable; parent = parent.parent) {
        if (
          ts.isTryStatement(parent) &&
          parent.catchClause &&
          node.pos >= parent.tryBlock.pos &&
          node.end <= parent.tryBlock.end
        ) {
          return;
        }
      }
      found = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(callable);
  return found;
}

/** Report missing summaries and signature tags with source locations suitable for CI logs. */
export function checkSource(source) {
  const errors = [];
  for (const { anchor, callable } of documentedDeclarations(source)) {
    const { line } = source.getLineAndCharacterOfPosition(anchor.getStart(source));
    const report = (message) => errors.push(`${source.fileName}:${line + 1}: ${message}`);
    const doc = ts.getJSDocCommentsAndTags(anchor).find(ts.isJSDoc);
    if (!doc || !commentText(doc.comment).trim()) report('Missing TSDoc purpose summary.');
    const tags = [...(doc?.tags ?? [])];
    const throws = tags.filter((tag) => tag.tagName.text === 'throws');
    if ((hasEscapingThrow(callable) && throws.length === 0) || throws.some((tag) => !commentText(tag.comment).trim())) {
      report('Expected a descriptive @throws tag for explicit escaping errors.');
    }
    for (const [index, parameter] of callable.parameters.entries()) {
      const name = parameterName(parameter, index);
      const matches = tags.filter((tag) => ts.isJSDocParameterTag(tag) && tag.name.getText(source) === name);
      if (matches.length !== 1 || !commentText(matches[0]?.comment).trim()) {
        report(`Expected one descriptive @param ${name} tag.`);
      }
    }
    if (!ts.isConstructorDeclaration(callable) && !ts.isSetAccessorDeclaration(callable)) {
      const returns = tags.filter(ts.isJSDocReturnTag);
      if (returns.length !== 1 || !commentText(returns[0]?.comment).trim()) {
        report('Expected one descriptive @returns tag.');
      }
    }
    for (const parameter of callable.typeParameters ?? []) {
      if (
        !tags.some(
          (tag) => tag.tagName.text === 'typeParam' && commentText(tag.comment).startsWith(`${parameter.name.text} - `),
        )
      ) {
        report(`Missing @typeParam ${parameter.name.text} description.`);
      }
    }
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = apiSourceFiles(resolve(repositoryRoot, 'apps/api/src'));
  let count = 0;
  const errors = files.flatMap((file) => {
    const source = ts.createSourceFile(
      relative(repositoryRoot, file),
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    count += documentedDeclarations(source).length;
    return checkSource(source);
  });
  if (errors.length) {
    process.stderr.write(`${errors.join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`API TSDoc check passed (${count} declarations in ${files.length} source files).\n`);
  }
}
