#!/usr/bin/env node

import { getBorderCharacters, table } from 'table';

import { ApolloClient } from 'apollo-client';
import { InMemoryCache } from 'apollo-cache-inmemory';
import { createHttpLink } from 'apollo-link-http';
import fetch from 'node-fetch';
import gql from 'graphql-tag';
import relativeDate from 'relative-date';
import { setContext } from 'apollo-link-context';
import yargs from 'yargs';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

function die(message) {
    console.error(message);
    process.exit(-1)
}

const argv = yargs
    .usage('$0 owner/repo', 'Print info about forks')
    .argv;

if (!GITHUB_TOKEN) {
    die("Set GITHUB_TOKEN to a GitHub personal access token https://help.github.com/articles/creating-a-personal-access-token-for-the-command-line/")
}

const authLink = setContext((_, { headers }) => {
    const token = GITHUB_TOKEN;
    return {
        headers: {
            ...headers,
            authorization: token ? `Bearer ${token}` : null,
        }
    }
});

const client = new ApolloClient({
    link: authLink.concat(createHttpLink({ uri: 'https://api.github.com/graphql', fetch: fetch })),
    cache: new InMemoryCache(),
});

function comparator(fn) {
    return (a, b) => {
        const k1 = fn(a);
        const k2 = fn(b);
        return k1 < k2 ? 1 : k2 < k1 ? -1 : 0;
    }
}

function report(source) {
    const repos = [source, ...source.forks.nodes];
    if (source.parent) {
        repos.unshift(source.parent);
    }
    repos.sort(comparator(r => new Date(r.pushedAt)));
    repos.sort(comparator(r => r.stargazers.totalCount));
    const headers = ['Owner', 'Last Push  ', 'Stars', 'Issues', 'Pull Requests', 'Forks', 'Homepage'];
    const data = [headers];
    function totalstr(count) {
        if (count.hasOwnProperty('totalCount')) {
            count = count.totalCount;
        }
        return count > 0 ? count : '-';
    }
    for (let r of repos) {
        data.push([r.nameWithOwner.split('/')[0], relativeDate(new Date(r.pushedAt)), totalstr(r.stargazers), totalstr(r.issues), totalstr(r.pullRequests), totalstr(r.forks), r.url])
    }
    const config = {
        border: { ...getBorderCharacters('void'), joinBody: '─' },
        columnDefault: {
            paddingLeft: 0,
            paddingRight: 1
        },
        columns: {
            1: { alignment: 'right' },
            2: { alignment: 'right' },
            3: { alignment: 'right' },
            4: { alignment: 'center', width: 10, wrapWord: true },
        },
        drawHorizontalLine: (index) => index == 1,
    };
    const output = table(data, config);
    console.log(output);
    const remaining = source.forks.totalCount - source.forks.nodes.length;
    if (remaining > 0) {
        console.info(`...and ${remaining} more.`)
    }
    if (source.parent) {
        const additionalForks = source.parent.forks.totalCount - 1;
        let suffix = '';
        if (additionalForks > 0) {
            suffix = `, which has ${additionalForks} additional forks (not shown)`;
        }
        console.info(`${source.nameWithOwner} is a fork of ${source.parent.nameWithOwner}${suffix}.`);
    }
}

const repo_nwo = argv['owner/repo'].replace(/^https:\/\/github\.com\//, '');
repo_nwo.split('/').length == 2 || die(usage)

const repo_owner = repo_nwo.split('/')[0];
const repo_name = repo_nwo.split('/')[1];

const FORKS_QUERY = gql`
query ($repo_owner: String!, $repo_name: String!) {
    repository(owner: $repo_owner, name: $repo_name) {
        ...repoParts
        parent {
            ...repoParts
            forks { totalCount }
        }
        forks(first:30, orderBy:{field: STARGAZERS, direction: DESC}) {
            totalCount
            nodes {
                ...repoParts
                forks { totalCount }
            }
        }
    }
}
fragment repoParts on Repository {
    issues { totalCount }
    stargazers { totalCount }
    pullRequests { totalCount }
    url
    nameWithOwner
    pushedAt
}
`;

async function query(repo_owner, repo_name) {
    return client.query({
        query: FORKS_QUERY,
        variables: { repo_owner, repo_name },
    })
        .then(({ data }) => data);
}

async function main() {
    try {
        const data = await query(repo_owner, repo_name);
        report(data.repository);
    } catch (error) {
        die(error.message || error);
    }
}

main();
