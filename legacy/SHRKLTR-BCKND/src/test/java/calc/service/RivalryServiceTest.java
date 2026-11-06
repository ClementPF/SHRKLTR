package calc.service;

import calc.Application;
import calc.DTO.*;
import calc.entity.*;
import calc.repository.*;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestExecutionListeners;
import org.springframework.test.context.junit4.SpringRunner;
import org.springframework.test.context.support.DependencyInjectionTestExecutionListener;
import org.springframework.test.context.support.DirtiesContextTestExecutionListener;

import java.text.ParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Created by clementperez on 03/06/18.
 */


@SpringBootTest(classes = {Application.class})
//@PropertySource(value = {"classpath:application.properties", "${api.config.location}"}, ignoreResourceNotFound = true)
@TestExecutionListeners(inheritListeners = false, listeners = {
        DependencyInjectionTestExecutionListener.class,
        DirtiesContextTestExecutionListener.class
})
@RunWith(SpringRunner.class)
public class RivalryServiceTest {


    private static final Logger LOG = LoggerFactory.getLogger(RivalryServiceTest.class);

    @Autowired
    private RivalryStatsService rivalryStatsService;
    @Autowired
    private UserService userService;
    @Autowired
    private TournamentService tournamentService;
    @Autowired
    private GameService gameService;
    @Autowired
    private GameRepository gameRepository;

    @Autowired
    private UserRepository userRepository;
    @Autowired
    private SportRepository sportRepository;
    @Autowired
    private StatsRepository statsRepository;
    @Autowired
    private RivalryStatsRepository rivalryStatsRepository;
    @Autowired
    private StatsService statsService;

    @Autowired
    private TournamentRepository tournamentRepository;

    UserServiceTest userServiceTest;
    GameServiceTest gameServiceTest;
    StatsServiceTest statsServiceTest;

    User user1;
    User user2;
    User user3;
    User user4;
    Stats stats1;
    Stats stats2;
    Sport sport1;
    Tournament tournament1;
    RivalryStats rivalryStats1;
    RivalryStats rivalryStats2;
    RivalryStatsDTO rivalryStatsDTO1;
    RivalryStatsDTO rivalryStatsDTO2;

    @Before
    @Test  public void setUp() {

        userServiceTest = new UserServiceTest();
        gameServiceTest = new GameServiceTest();
        statsServiceTest = new StatsServiceTest();

        user1 = userRepository.save(userServiceTest.makeRandomUser());
        user2 = userRepository.save(userServiceTest.makeRandomUser());
        user3 = userRepository.save(userServiceTest.makeRandomUser());
        user4 = userRepository.save(userServiceTest.makeRandomUser());

        Sport pingpong = new Sport(UUID.randomUUID().toString());
        sport1 = sportRepository.save(pingpong);

        Tournament pingpongTournament = new Tournament(UUID.randomUUID().toString(),sport1,user1);
        tournament1 = tournamentRepository.save(pingpongTournament);

        stats1 = statsRepository.save(statsServiceTest.makeRandomStats(user1,tournament1));
        stats2 = statsRepository.save(statsServiceTest.makeRandomStats(user2,tournament1));


        rivalryStats1 = rivalryStatsService.save(makeRandomRivalryStats(user1,user2,stats1));
        rivalryStats2 = rivalryStatsService.save(makeRandomRivalryStats(user2,user1,stats2));

        rivalryStatsDTO1 = rivalryStatsService.convertToDto(rivalryStats1);
        rivalryStatsDTO2 = rivalryStatsService.convertToDto(rivalryStats2);
    }

    @Test
    public void findByTournament(){

        List<RivalryStatsDTO> fetched = rivalryStatsService.findByTournament(tournamentService.convertToDto(tournament1));

        assertThat(fetched.get(0)).isEqualToComparingFieldByFieldRecursively(rivalryStatsDTO1);
        assertThat(fetched.get(1)).isEqualToComparingFieldByFieldRecursively(rivalryStatsDTO2);
    }

    //@Test(expected = APIException.class)
    public void findByTournament_notFound(){

        Tournament tournament_NotExist = new Tournament(UUID.randomUUID().toString(),sport1,user1);
        tournament_NotExist.setTournamentId(123L);

        List<RivalryStatsDTO> fetched = rivalryStatsService.findByTournament(tournamentService.convertToDto(tournament_NotExist));
    }

    @Test
    public void findByUser(){
        List<RivalryStatsDTO> fetched1 = rivalryStatsService.findByUser(userService.convertToDto(user1));
        List<RivalryStatsDTO> fetched2 = rivalryStatsService.findByUser(userService.convertToDto(user2));

        assertThat(fetched1.get(0)).isEqualToComparingFieldByFieldRecursively(rivalryStatsDTO1);
        assertThat(fetched2.get(0)).isEqualToComparingFieldByFieldRecursively(rivalryStatsDTO2);
    }

    //@Test(expected = APIException.class)
    public void findByUser_notFound(){
        List<RivalryStatsDTO> fetched1 = rivalryStatsService.findByUser(userServiceTest.makeRandomUserDTO());
    }

    @Test
    public void findByUsername(){
        List<RivalryStatsDTO> fetched1 = rivalryStatsService.findByUsername(user1.getUserName());
        List<RivalryStatsDTO> fetched2 = rivalryStatsService.findByUsername(user2.getUserName());

        assertThat(fetched1.get(0)).isEqualToComparingFieldByFieldRecursively(rivalryStatsDTO1);
        assertThat(fetched2.get(0)).isEqualToComparingFieldByFieldRecursively(rivalryStatsDTO2);
    }

    //@Test(expected = APIException.class)
    public void findByUsername_notFound(){
        List<RivalryStatsDTO> fetched1 = rivalryStatsService.findByUsername(userServiceTest.makeRandomUserDTO().getUsername());
    }

    @Test
    public void findByRival(){
        List<RivalryStatsDTO> fetched1 = rivalryStatsService.findByRival(userService.convertToDto(user2));
        List<RivalryStatsDTO> fetched2 = rivalryStatsService.findByRival(userService.convertToDto(user1));

        assertThat(fetched1.get(0)).isEqualToComparingFieldByFieldRecursively(rivalryStatsDTO1);
        assertThat(fetched2.get(0)).isEqualToComparingFieldByFieldRecursively(rivalryStatsDTO2);
    }

    //@Test(expected = APIException.class)
    public void findByRival_notFound(){
        List<RivalryStatsDTO> fetched1 = rivalryStatsService.findByRival(userServiceTest.makeRandomUserDTO());
    }

    @Test
    public void save(){

    }

    @Test
    public void findByUserAndTournament(){
        List<RivalryStatsDTO> fetched1 = rivalryStatsService.findByUserAndTournament(user1.getUserId(), tournament1.getTournamentId());
        List<RivalryStatsDTO> fetched2 = rivalryStatsService.findByUserAndTournament(user2.getUserId(), tournament1.getTournamentId());

        assertThat(fetched1.get(0)).isEqualToComparingFieldByFieldRecursively(rivalryStatsDTO1);
        assertThat(fetched2.get(0)).isEqualToComparingFieldByFieldRecursively(rivalryStatsDTO2);
    }

    //@Test(expected = APIException.class)
    public void findByUserAndTournament_UserNotFound(){
        List<RivalryStatsDTO> fetched1 = rivalryStatsService.findByUserAndTournament(212L,tournament1.getTournamentId());
    }

    //@Test(expected = APIException.class)
    public void findByUserAndTournament_TournamentNotFound(){
        List<RivalryStatsDTO> fetched1 = rivalryStatsService.findByUserAndTournament(user1.getUserId(),2345L);
    }

    @Test  public void findByRivalAndTournament(){
        List<RivalryStatsDTO> fetched1 = rivalryStatsService.findByRivalAndTournament(user2.getUserId(), tournament1.getTournamentId());
        List<RivalryStatsDTO> fetched2 = rivalryStatsService.findByRivalAndTournament(user1.getUserId(), tournament1.getTournamentId());

        assertThat(fetched1.get(0)).isEqualToComparingFieldByFieldRecursively(rivalryStatsDTO1);
        assertThat(fetched2.get(0)).isEqualToComparingFieldByFieldRecursively(rivalryStatsDTO2);
    }

    //@Test(expected = APIException.class)
    public void findByRivalAndTournament_RivalNotFound(){
        List<RivalryStatsDTO> fetched1 = rivalryStatsService.findByRivalAndTournament(212L, tournament1.getTournamentId());
    }

    //@Test(expected = APIException.class)
    public void findByRivalAndTournament_TournamentNotFound(){
        List<RivalryStatsDTO> fetched1 = rivalryStatsService.findByRivalAndTournament(user1.getUserId(), 2345L);

    }

    @Test
    public void findByUserNameAndTournament(){
        List<RivalryStatsDTO> fetched1 = rivalryStatsService.findByUserNameAndTournament(user1.getUserName(), tournament1.getName());
        List<RivalryStatsDTO> fetched2 = rivalryStatsService.findByUserNameAndTournament(user2.getUserName(), tournament1.getName());

        assertThat(fetched1.get(0)).isEqualToComparingFieldByFieldRecursively(rivalryStatsDTO1);
        assertThat(fetched2.get(0)).isEqualToComparingFieldByFieldRecursively(rivalryStatsDTO2);
    }

    //@Test(expected = APIException.class)
    public void findByUserNameAndTournament_usernameNotFound(){
        List<RivalryStatsDTO> fetched1 = rivalryStatsService.findByUserNameAndTournament("plop",tournament1.getName());
    }

    //@Test(expected = APIException.class)
    public void findByUserNameAndTournament_tournamentNotFound(){
        List<RivalryStatsDTO> fetched1 = rivalryStatsService.findByUserNameAndTournament(user1.getUserName(),"plop");
    }

    @Test
    public void findByRivalUserNameAndTournament(){
        List<RivalryStatsDTO> fetched1 = rivalryStatsService.findByRivalUserNameAndTournament(user2.getUserName(), tournament1.getName());
        List<RivalryStatsDTO> fetched2 = rivalryStatsService.findByRivalUserNameAndTournament(user1.getUserName(), tournament1.getName());

        assertThat(fetched1.get(0)).isEqualToComparingFieldByFieldRecursively(rivalryStatsDTO1);
        assertThat(fetched2.get(0)).isEqualToComparingFieldByFieldRecursively(rivalryStatsDTO2);
    }

    //@Test(expected = APIException.class)
    public void findByRivalUserNameAndTournament_usernameNotFound(){
        List<RivalryStatsDTO> fetched1 = rivalryStatsService.findByRivalUserNameAndTournament("plop", tournament1.getName());
    }

    //@Test(expected = APIException.class)
    public void findByRivalUserNameAndTournament_tournamentNotFound(){
        List<RivalryStatsDTO> fetched1 = rivalryStatsService.findByRivalUserNameAndTournament(user1.getUserName(), "plop");
    }

    @Test
    public void findByUserAndRivalAndTournament(){
        RivalryStatsDTO fetched1 = rivalryStatsService.findByUserAndRivalAndTournament(user1.getUserId(),user2.getUserId(),tournament1.getTournamentId());
        RivalryStatsDTO fetched2 = rivalryStatsService.findByUserAndRivalAndTournament(user2.getUserId(),user1.getUserId(),tournament1.getTournamentId());

        assertThat(fetched1).isEqualToComparingFieldByFieldRecursively(rivalryStatsDTO1);
        assertThat(fetched2).isEqualToComparingFieldByFieldRecursively(rivalryStatsDTO2);
    }

    //@Test(expected = APIException.class)
    public void findByUserAndRivalAndTournament_usernameNotFound(){
        RivalryStatsDTO fetched1 = rivalryStatsService.findByUserAndRivalAndTournament(125487L, user2.getUserId(), tournament1.getTournamentId());
    }

    //@Test(expected = APIException.class)
    public void findByUserAndRivalAndTournament_rivalnameNotFound(){
        RivalryStatsDTO fetched1 = rivalryStatsService.findByUserAndRivalAndTournament(user1.getUserId(),125487L,tournament1.getTournamentId());
    }

    //@Test(expected = APIException.class)
    public void findByUserAndRivalAndTournament_tournamentNotFound(){
        RivalryStatsDTO fetched1 = rivalryStatsService.findByUserAndRivalAndTournament(user1.getUserId(), user2.getUserId(), 654L);
    }

    @Test
    public void findByUserAndRivalAndTournamentCreateIfNone(){
        Tournament tournament = tournamentRepository.save(new Tournament(UUID.randomUUID().toString(),sport1,user1));
        RivalryStatsDTO fetched1 = rivalryStatsService.findByUserAndRivalAndTournament(user1.getUserId(),user2.getUserId(),tournament.getTournamentId());

        Stats stats = statsRepository.save(statsServiceTest.makeRandomStats(user1,tournament));

        assertThat(fetched1).isNull();

        rivalryStatsService.findByStatsAndRivalCreateIfNone(statsService.convertToDto(stats), userService.convertToDto(user2));

        fetched1 = rivalryStatsService.findByUserAndRivalAndTournament(user1.getUserId(),user2.getUserId(),tournament.getTournamentId());

        assertThat(fetched1).isNotNull();
    }

    @Test
    public void convertToEntity() {
        Tournament tournament = tournamentRepository.save(new Tournament(UUID.randomUUID().toString(),sport1,user1));
        Stats stats = statsRepository.save(statsServiceTest.makeRandomStats(user1,tournament));
        RivalryStatsDTO fetched1 = rivalryStatsService.findByStatsAndRivalCreateIfNone(statsService.convertToDto(stats), userService.convertToDto(user2));
        RivalryStatsDTO converted = null;
        try {
            converted = rivalryStatsService.convertToDto(rivalryStatsService.convertToEntity(fetched1));
        } catch (ParseException e) {
            e.printStackTrace();
        }

        assertThat(fetched1.getRivalryStatsId()).isEqualTo(converted.getRivalryStatsId());
        assertThat(fetched1.getUser().getUserId()).isEqualTo(converted.getUser().getUserId());
        assertThat(fetched1.getRival().getUserId()).isEqualTo(converted.getRival().getUserId());
        assertThat(fetched1.getTournament().getTournamentId()).isEqualTo(converted.getTournament().getTournamentId());
    }

    @Test
    public void whenValidGame_thenRivalryStatsShouldBeFound() {

        Tournament tournament = tournamentRepository.save(new Tournament(UUID.randomUUID().toString(),sport1,user1));
        Game g = gameServiceTest.makeRandomGame(user1,user2,tournament);

        Stats s1 = statsServiceTest.makeRandomStats(user1,tournament);
        Stats s2 = statsServiceTest.makeRandomStats(user2,tournament);
        statsRepository.save(s1);
        statsRepository.save(s2);

        gameService.saveTest(userService.convertToDto(user2),gameService.convertToDto(g));

        RivalryStatsDTO rs1 = rivalryStatsService.findByUserAndRivalAndTournament(user1.getUserId(),user2.getUserId(),tournament.getTournamentId());
        RivalryStatsDTO rs2 = rivalryStatsService.findByUserAndRivalAndTournament(user2.getUserId(),user1.getUserId(),tournament.getTournamentId());

        assertThat(rs1).isNotNull();
        assertThat(rs2).isNotNull();
    }

    @Test
    public void whenValidGames_thenRivalryStatsShouldBeValid() {
        double totalScore = 0;

        Tournament tournament = tournamentRepository.save(new Tournament(UUID.randomUUID().toString(),sport1,user1));

        int gameCount = 1 + new Random().nextInt(50);

        Stats s1 = statsServiceTest.makeRandomStats(user1,tournament);
        Stats s2 = statsServiceTest.makeRandomStats(user2,tournament);
        statsRepository.save(s1);
        statsRepository.save(s2);

        List<RivalryStats> rivalryStatsList = null;
        RivalryStats rs2 = null;

        for(int i = 0; i < gameCount; i++){
            Boolean b = new Random().nextBoolean();
            Game g = gameServiceTest.makeRandomGame(b ? user1 : user2, !b ? user1 : user2,tournament);
            gameRepository.save(g);
            totalScore = totalScore + g.getOutcomes().get(b?1:0).getScoreValue();
            rivalryStatsList = rivalryStatsService.recalculateAfterGame(g);
        }

        RivalryStats userRivalryStats = rivalryStatsList.get(0);
        assertThat(Math.abs(userRivalryStats.getScore())).isEqualTo(Math.abs(totalScore));
        assertThat(userRivalryStats.getGameCount()).isEqualTo(gameCount);
        RivalryStats rivalRivalryStats = rivalryStatsRepository.findByUserUserIdAndRivalUserIdAndTournamentTournamentId(userRivalryStats.getRival().getUserId(),userRivalryStats.getUser().getUserId(),tournament.getTournamentId());
        assertThat(userRivalryStats.getScore()).isEqualTo(-rivalRivalryStats.getScore());
    }

    @Test
    public void whenValidGamesNvsN_thenRivalryStatsShouldBeValid() {
        double teamAScoreSum = 0;
        double teamBScoreSum = 0;

        Tournament tournament = tournamentRepository.save(new Tournament(UUID.randomUUID().toString(),sport1,user1));

        int gameCount = new Random().nextInt(10) + 1;
        int teamSize = new Random().nextInt(10) + 1;

        List<UserDTO> teamA = new ArrayList<>();
        List<UserDTO> teamB = new ArrayList<>();
        List<StatsDTO> teamAStats = new ArrayList<>();
        List<StatsDTO> teamBStats = new ArrayList<>();

        for(int i = 0; i < teamSize * 2; i ++){
            User user = userRepository.save(userServiceTest.makeRandomUser());
            UserDTO u = userService.convertToDto(user);
            StatsDTO s = statsService.convertToDto(statsRepository.save(statsServiceTest.makeRandomStats(user, tournament)));
            if(i%2 == 0){
                teamA.add(u);
                teamAStats.add(s);
            }else{
                teamB.add(u);
                teamBStats.add(s);
            }
        }

        for(int i = 0; i < gameCount; i++){
            Boolean b = new Random().nextBoolean();
            GameDTO g = gameServiceTest.makeRandomGameDTO(b ? teamA : teamB, !b ? teamA : teamB,tournamentService.convertToDto(tournament));
            //GameDTO g = gameServiceTest.makeRandomGameDTO(b ? teamA : teamB, !b ? teamA : teamB, tournament);
            UserDTO fakeLoggedInUser = g.getOutcomes().stream().filter(OutcomeDTO::isLose).findFirst().get().getUser();
            teamAScoreSum = teamAScoreSum + g.getOutcomes().stream().filter(o -> b ? o.isWin() : o.isLose() ).findFirst().get().getScoreValue();
            teamBScoreSum = teamBScoreSum + g.getOutcomes().stream().filter(o -> b ? o.isLose() : o.isWin() ).findFirst().get().getScoreValue();
            gameService.saveTest(fakeLoggedInUser,g);
        }

        LOG.debug("teamSize " + teamSize + " gameCount " + gameCount + " teamAScoreSum " + teamAScoreSum + " teamBScoreSum " + teamBScoreSum);
        for(int i = 0; i < teamSize; i ++){
            UserDTO userA = teamA.get(i);
            for(int j = 0; j < teamSize; j++){
                UserDTO userB = teamB.get(j);
                LOG.debug(" userA.id " + userA.getUserId() + " userB.id " + userB.getUserId());
                RivalryStats rs1 = rivalryStatsRepository.findByUserUserNameAndRivalUserNameAndTournamentName(userA.getUsername(),userB.getUsername(),tournament.getName());
                RivalryStats rs2 = rivalryStatsRepository.findByUserUserNameAndRivalUserNameAndTournamentName(userB.getUsername(),userA.getUsername(),tournament.getName());

                LOG.debug(" rs1.getScore()= " + rs1.getScore());
                assertThat(rs1.getScore()).isEqualTo(-rs2.getScore());
                assertThat(rs1.getGameCount()).isEqualTo(rs2.getGameCount());
                assertThat(rs1.getGameCount()).isEqualTo(gameCount);
                assertThat(rs1.getScore()).isEqualTo(teamAScoreSum); // floating value
                assertThat(rs2.getScore()).isEqualTo(teamBScoreSum); // floating value
            }
        }
    }

    /*
    *
    *
    @Test
    public void whenValidGamesNvsN_thenRivalryStatsShouldBeValid() {
        double totalScore = 0;

        Tournament tournament = tournamentRepository.save(new Tournament(UUID.randomUUID().toString(),sport1,user1));

        int gameCount = new Random().nextInt(10);
        int teamSize = new Random().nextInt(10) + 1;

        List<User> teamA = new ArrayList<>();
        List<User> teamB = new ArrayList<>();
        List<Stats> teamAStats = new ArrayList<>();
        List<Stats> teamBStats = new ArrayList<>();

        for(int i = 0; i < teamSize * 2; i ++){
            User u = userRepository.save(userServiceTest.makeRandomUser());
            Stats s = statsRepository.save(statsServiceTest.makeRandomStats(u, tournament));
            if(i%2 == 0){
                teamA.add(u);
                teamAStats.add(s);
            }else{
                teamB.add(u);
                teamBStats.add(s);
            }
        }

        for(int i = 0; i < gameCount; i++){
            Boolean b = new Random().nextBoolean();
            List<RivalryStats> listRs = new ArrayList<RivalryStats>();
            Game g = gameServiceTest.makeRandomGame(b ? teamA : teamB, !b ? teamA : teamB,tournament);
            gameRepository.save(g);

            Outcome outcome = g.getOutcomes().stream().filter(o->o.getUser().getUserId() == teamA.get(0).getUserId()).findFirst().get();
            totalScore = totalScore + outcome.getScoreValue();

            for(Stats statsA : teamAStats){
                List<Outcome> teamBOutcomes = g.getOutcomes().stream().filter(o -> o.getResults() == (b ? Outcome.Result.LOSS : Outcome.Result.WIN)).collect(Collectors.toList());
                Outcome userOutcome = g.getOutcomes().stream().filter(o -> o.getUser().getUserId() == statsA.getUser().getUserId()).findFirst().get();
                LOG.debug("rivalryStatsService.recalculateAfterTeamOutcomes " + userOutcome.getUser().getUserId() + " " + userOutcome.getResults().name() + " score: " + userOutcome.getScoreValue());
                List<RivalryStats> lrs = rivalryStatsService.recalculateAfterOutcomes(statsA, userOutcome, teamBOutcomes.toArray(new Outcome[0]));
                listRs.addAll(lrs);
            }

            for(Stats statsB : teamBStats){
                List<Outcome> teamAOutcomes = g.getOutcomes().stream().filter(o -> o.getResults() == (!b ? Outcome.Result.LOSS : Outcome.Result.WIN)).collect(Collectors.toList());
                Outcome userOutcome = g.getOutcomes().stream().filter(o -> o.getUser().getUserId() == statsB.getUser().getUserId()).findFirst().get();
                LOG.debug("rivalryStatsService.recalculateAfterTeamOutcomes " + userOutcome.getUser().getUserId() + " " + userOutcome.getResults().name() + " score: " + userOutcome.getScoreValue());
                List<RivalryStats> lrs = rivalryStatsService.recalculateAfterOutcomes(statsB, userOutcome, teamAOutcomes.toArray(new Outcome[0]));
                listRs.addAll(lrs);
            }

            for (RivalryStats rs : listRs) {
                LOG.debug(listRs.size() + " rivalryStatsService.save " + rs.getRivalryStatsId() + " " + rs.getScore() + " " + rs.getUser().getUserId() + " " + rs.getRival().getUserId() );
                rivalryStatsService.save(rs);
                statsRepository.save(statsService.recalculateBestRivalry(rs));
                statsRepository.save(statsService.recalculateWorstRivalry(rs));
            }
        }

        for(int i = 0; i < teamSize; i ++){
            User userA = teamA.get(i);
            for(int j = 0; j < teamSize; j++){
                User userB = teamB.get(j);
                LOG.debug(" userA.id " + userA.getUserId() + " userB.id " + userB.getUserId());
                RivalryStats rs1 = rivalryStatsRepository.findByUserUserNameAndRivalUserNameAndTournamentName(userA.getUserName(),userB.getUserName(),tournament.getName());
                RivalryStats rs2 = rivalryStatsRepository.findByUserUserNameAndRivalUserNameAndTournamentName(userB.getUserName(),userA.getUserName(),tournament.getName());
                assertThat(rs1.getScore()).isEqualTo(-rs2.getScore());
                assertThat(rs1.getGameCount()).isEqualTo(rs2.getGameCount());
                assertThat(rs1.getGameCount()).isEqualTo(gameCount);
                assertThat(Math.abs(rs1.getScore() - totalScore/teamSize)).isLessThan(0.000000000000010); // floating value
            }
        }
    }*/

    public RivalryStats makeRandomRivalryStats(User user, User rival, Stats stats){
        RivalryStats rivalryStats = new RivalryStats(user, rival ,stats);

        rivalryStats.setScore(new Random().nextDouble()*20);
        rivalryStats.setBestScore(Math.max(new Random().nextDouble(), rivalryStats.getScore()));
        rivalryStats.setWorstScore(Math.min(new Random().nextDouble(), rivalryStats.getScore()));

        rivalryStats.setLoseCount(Math.abs(new Random().nextInt()));
        rivalryStats.setTieCount(Math.abs(new Random().nextInt()));
        rivalryStats.setWinCount(Math.abs(new Random().nextInt()));
        rivalryStats.setGameCount(rivalryStats.getLoseCount() + rivalryStats.getWinCount() + rivalryStats.getLoseCount());

        rivalryStats.setWinStreak(new Random().nextInt(rivalryStats.getWinCount()));
        rivalryStats.setLoseStreak(new Random().nextInt(rivalryStats.getLoseCount()));
        rivalryStats.setTieStreak(new Random().nextInt(rivalryStats.getTieCount()));

        rivalryStats.setLonguestWinStreak(new Random().nextInt(rivalryStats.getWinCount()));
        rivalryStats.setLonguestLoseStreak(new Random().nextInt(rivalryStats.getLoseCount()));
        rivalryStats.setLonguestTieStreak(new Random().nextInt(rivalryStats.getTieCount()));

        return rivalryStats;
    }
}