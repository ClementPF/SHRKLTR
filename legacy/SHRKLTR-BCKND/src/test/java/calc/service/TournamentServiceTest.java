package calc.service;

import calc.DTO.*;
import calc.entity.Sport;
import calc.entity.Tournament;
import calc.entity.User;
import calc.exception.APIException;
import calc.repository.SportRepository;
import calc.repository.StatsRepository;
import calc.repository.TournamentRepository;
import calc.repository.UserRepository;
import org.assertj.core.api.AbstractObjectAssert;
import org.hamcrest.Matchers;
import org.hamcrest.core.AnyOf;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.TestExecutionListeners;
import org.springframework.test.context.junit4.SpringRunner;
import org.springframework.test.context.support.DependencyInjectionTestExecutionListener;
import org.springframework.test.context.support.DirtiesContextTestExecutionListener;

import java.text.ParseException;
import java.util.*;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Created by clementperez on 31/08/18.
 */
@SpringBootTest
//@PropertySource(value = {"classpath:application.properties", "${api.config.location}"}, ignoreResourceNotFound = true)
@TestExecutionListeners(inheritListeners = false, listeners = {
        DependencyInjectionTestExecutionListener.class,
        DirtiesContextTestExecutionListener.class
})
@RunWith(SpringRunner.class)
public class TournamentServiceTest {

    @Autowired
    private TournamentService tournamentService;
    @Autowired
    private TournamentRepository tournamentRepository;
    @Autowired
    private UserService userService;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private SportService sportService;
    @Autowired
    private SportRepository sportRepository;
    @Autowired
    private StatsRepository statsRepository;

    UserServiceTest userServiceTest;
    TournamentServiceTest tournamentServiceTest;
    GameServiceTest gameServiceTest;
    RivalryServiceTest rivalryServiceTest;
    SportServiceTest sportServiceTest;
    StatsServiceTest statsServiceTest;

    @Before
    public void setUp() {
        userServiceTest = new UserServiceTest();
        tournamentServiceTest = new TournamentServiceTest();
        gameServiceTest = new GameServiceTest();
        statsServiceTest = new StatsServiceTest();
        rivalryServiceTest = new RivalryServiceTest();
        sportServiceTest = new SportServiceTest();
    }

    @Test
    public void findBySport(){
        User owner = userRepository.save(userServiceTest.makeRandomUser());
        Sport sport = sportRepository.save(sportServiceTest.makeRandomSport());

        Tournament t1 = tournamentRepository.save(tournamentServiceTest.makeRandomTournament(sport,owner));

        List<TournamentDTO> tournamentDTOs = tournamentService.findBySport(sportService.convertToDto(sport));
        for(TournamentDTO t: tournamentDTOs){
            assertThat(tournamentService.convertToDto(t1)).isEqualToComparingFieldByFieldRecursively(t);
        }
    }

    //@Test
    public void findAll(){
        User owner = userRepository.save(userServiceTest.makeRandomUser());
        Sport sport = sportRepository.save(sportServiceTest.makeRandomSport());

        List<Tournament> tournaments = new ArrayList<>();
        tournaments.add(tournamentRepository.save(tournamentServiceTest.makeRandomTournament(sport,owner)));
        tournaments.add(tournamentRepository.save(tournamentServiceTest.makeRandomTournament(sport,owner)));
        tournaments.add(tournamentRepository.save(tournamentServiceTest.makeRandomTournament(sport, owner)));
        tournaments.add(tournamentRepository.save(tournamentServiceTest.makeRandomTournament(sport,owner)));

        List<TournamentDTO> tournamentDTOs = tournamentService.findAll();
        assertThat(tournamentDTOs.size()).isLessThan(tournaments.size());
    }

    @Test
    public void findBySportId_found(){
        User owner = userRepository.save(userServiceTest.makeRandomUser());
        Sport sport = sportRepository.save(sportServiceTest.makeRandomSport());

        Tournament t1 = tournamentRepository.save(tournamentServiceTest.makeRandomTournament(sport,owner));

        List<TournamentDTO> tournamentDTOs = tournamentService.findBySportId(sport.getSportId());
        for(TournamentDTO t: tournamentDTOs){
            assertThat(tournamentService.convertToDto(t1)).isEqualToComparingFieldByFieldRecursively(t);
        }
    }

    @Test(expected = APIException.class)
    public void findBySportId_notFound(){
        List<TournamentDTO> tournamentDTOs = tournamentService.findBySportId(new Random().nextLong());
    }

    @Test
    public void findByUserName_found() {
        User user = userRepository.save(userServiceTest.makeRandomUser());
        Sport sport = sportRepository.save(sportServiceTest.makeRandomSport());

        Tournament t1 = tournamentRepository.save(tournamentServiceTest.makeRandomTournament(sport,user));
        Tournament t2 = tournamentRepository.save(tournamentServiceTest.makeRandomTournament(sport,user));
        Tournament t3 = tournamentRepository.save(tournamentServiceTest.makeRandomTournament(sport,user));

        statsRepository.save(statsServiceTest.makeRandomStats(user,t1));
        statsRepository.save(statsServiceTest.makeRandomStats(user,t2));
        statsRepository.save(statsServiceTest.makeRandomStats(user,t3));

        List<TournamentDTO> tournaments = tournamentService.findByUserName(user.getUserName());

        assertThat(tournaments.size()).isEqualTo(tournaments.size());
    }

    @Test(expected = APIException.class)
    public void findByUserName_notFound() {
        List<TournamentDTO> tournaments = tournamentService.findByUserName(UUID.randomUUID().toString());
    }

    //@Test  need to sort out whosloggedin
    public void createTournament() {
        User user = userRepository.save(userServiceTest.makeRandomUser());
        UserDTO userDTO = userService.convertToDto(user);
        SportDTO sport = sportService.save(sportServiceTest.makeRandomSportDTO());
        TournamentDTO tournamentDTO = tournamentServiceTest.makeRandomTournamentDTO(sport,userDTO);
        TournamentDTO createdTournament = tournamentService.createTournament(tournamentDTO);

        assertThat(tournamentDTO).isEqualToComparingFieldByFieldRecursively(createdTournament);
    }

    //@Test(expected = APIException.class)  need to sort out whosloggedin
    public void createTournament_already_exists() {
        User user = userRepository.save(userServiceTest.makeRandomUser());
        UserDTO userDTO = userService.convertToDto(user);
        SportDTO sport = sportService.save(sportServiceTest.makeRandomSportDTO());
        TournamentDTO tournamentDTO = tournamentServiceTest.makeRandomTournamentDTO(sport, userDTO);
        TournamentDTO createdTournament = tournamentService.createTournament(tournamentDTO);
        createdTournament = tournamentService.createTournament(tournamentDTO);
    }

    @Test(expected = APIException.class)
    public void createTournament_no_sport() {
        User user = userRepository.save(userServiceTest.makeRandomUser());
        UserDTO userDTO = userService.convertToDto(user);
        TournamentDTO tournamentDTO = tournamentServiceTest.makeRandomTournamentDTO(null,userDTO);
        tournamentService.createTournament(tournamentDTO);
    }

    @Test
    public void save(){
        User user = userRepository.save(userServiceTest.makeRandomUser());
        UserDTO userDTO = userService.convertToDto(user);
        SportDTO sport = sportService.save(sportServiceTest.makeRandomSportDTO());
        TournamentDTO tournamentDTO = tournamentServiceTest.makeRandomTournamentDTO(sport,userDTO);

        tournamentDTO = tournamentService.save(tournamentDTO);
        TournamentDTO created = tournamentService.findByName(tournamentDTO.getName());

        assertThat(tournamentDTO).isEqualToComparingFieldByFieldRecursively(created);
    }

    @Test
    public void update(){

    }

    @Test
    public void delete(){

    }

    @Test
    public void findByName(){
        User user = userRepository.save(userServiceTest.makeRandomUser());
        UserDTO userDTO = userService.convertToDto(user);
        SportDTO sport = sportService.save(sportServiceTest.makeRandomSportDTO());
        TournamentDTO tournamentDTO = tournamentServiceTest.makeRandomTournamentDTO(sport,userDTO);

        tournamentDTO = tournamentService.save(tournamentDTO);
        TournamentDTO created = tournamentService.findByName(tournamentDTO.getName());

        assertThat(tournamentDTO).isEqualToComparingFieldByFieldRecursively(created);
    }

    @Test
    public void addGameForTournament(){

    }

    @Test
    public void convertToEntity() {
        User user = userRepository.save(userServiceTest.makeRandomUser());
        UserDTO userDTO = userService.convertToDto(user);
        SportDTO sport = sportService.save(sportServiceTest.makeRandomSportDTO());
        TournamentDTO tournamentDTO = tournamentServiceTest.makeRandomTournamentDTO(sport,userDTO);
        Tournament t = null;
        try {
            t = tournamentService.convertToEntity(tournamentDTO);
        } catch (ParseException e) {
            e.printStackTrace();
        }

        assertThat(t).isNotNull();
        if(t == null) return;
        assertThat(tournamentDTO.getDisplayName()).isEqualTo(t.getDisplayName());
        assertThat(tournamentDTO.getIsOver()).isEqualTo(t.getIsOver());
        // can't test for name equality because it's being generated from the constructor;
        //assertThat(tournamentDTO.getName()).isEqualTo(t.getName());
        assertThat(tournamentDTO.getSport().getSportId()).isEqualTo(t.getSport().getSportId());
        assertThat(tournamentDTO.getTournamentId()).isEqualTo(t.getTournamentId());
        assertThat(tournamentDTO.getOwner().getUserId()).isEqualTo(t.getOwner().getUserId());
    }

    @Test
    public void convertToDto() {

    }



    public TournamentDTO makeRandomTournamentDTO(SportDTO sport, UserDTO owner){

        TournamentDTO t = new TournamentDTO(UUID.randomUUID().toString(), sport, owner);

        t.setTournamentId(new Random().nextLong());
        t.setName(UUID.randomUUID().toString());
        t.setIsOver(new Random().nextBoolean());

        return t;
    }

    public Tournament makeRandomTournament(Sport sport, User owner){

        Tournament t = new Tournament(UUID.randomUUID().toString(),sport, owner);

        t.setTournamentId(new Random().nextLong());
        t.setIsOver(new Random().nextBoolean());

        return t;
    }
}
