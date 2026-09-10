import { type GetServerSideProps } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';

import MainLayout from '~/components/Layout/MainLayout';
import { ImportExpensesFromCsv } from '~/components/group/ImportExpensesFromCsv';
import { Button } from '~/components/ui/button';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { db } from '~/server/db';
import { type NextPageWithUser } from '~/types';
import { customServerSideTranslations } from '~/utils/i18n/server';

const ImportExpensesPage: NextPageWithUser = ({ user }) => {
  const { t } = useTranslationWithUtils();
  const router = useRouter();
  const groupId = Number(router.query.groupId);

  return (
    <>
      <Head>
        <title>{t('group_details.import_csv.title')}</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <MainLayout hideAppBar>
        <div className="flex items-center justify-between">
          <Link href={`/groups/${groupId}`}>
            <Button variant="ghost" className="text-primary px-0 py-0" size="sm">
              {t('actions.cancel')}
            </Button>
          </Link>
          <div className="font-medium">{t('group_details.import_csv.title')}</div>
          {/* Balances the cancel button so the title stays centred. */}
          <div className="w-[52px]" />
        </div>
        <ImportExpensesFromCsv groupId={groupId} user={user} />
      </MainLayout>
    </>
  );
};

ImportExpensesPage.auth = true;

export default ImportExpensesPage;

export const getServerSideProps: GetServerSideProps = async (context) => {
  const group = await db.group.findFirst({
    where: {
      id: Number(context.query.groupId),
    },
  });

  if (!group) {
    return {
      redirect: {
        destination: '/groups',
        permanent: false,
      },
    };
  }

  // Archived groups reject new expenses, so send them to the group page, which explains why.
  if (group.archivedAt) {
    return {
      redirect: {
        destination: `/groups/${group.id}`,
        permanent: false,
      },
    };
  }

  return {
    props: {
      ...(await customServerSideTranslations(context.locale, ['common', 'currencies'])),
    },
  };
};
